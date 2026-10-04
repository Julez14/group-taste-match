import { DurableObject } from "cloudflare:workers";
import type { ActionBody, JoinBody, RoomPeek, TranscribeResponse } from "../shared/api";
import { defaultProfileId, profile } from "../shared/data";
import {
  ackTranscription,
  applyOutcome,
  createRoom,
  failEvaluation,
  isInputPhase,
  isProcessingPhase,
  join,
  MachineError,
  nextWakeAt,
  removeParticipant,
  requiredResponders,
  resolveTranscription,
  retry,
  start,
  submit,
  tick,
} from "../shared/room-machine";
import {
  type DecisionMethod,
  INPUT_PHASE_KIND,
  type RoomConfig,
  type RoomState,
  type SubmissionKind,
  TRANSCRIPTION_GRACE_MS,
} from "../shared/types";
import { type RoomView, toView } from "../shared/view";
import { bindingClient } from "../server/ai";
import { selectPipeline } from "../server/select-pipeline";
import { FIXTURE_TRANSCRIPT, MAX_AUDIO_BYTES, transcribe } from "../server/transcribe";
import { hashToken, newToken, randomId } from "./tokens";

export type RpcResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const MAX_AUTO_ATTEMPTS = 3;
const AUTO_RETRY_DELAY_MS = 2_000;
const MAX_TRANSCRIPTIONS_PER_PHASE = 6;

type SocketAttachment = { pid: string } | null;

function errorResult(e: unknown): { ok: false; code: string; message: string } {
  if (e instanceof MachineError) return { ok: false, code: e.code, message: e.message };
  console.error(e);
  return { ok: false, code: "internal", message: "Something went wrong." };
}

export class Room extends DurableObject<Env> {
  private room: RoomState | null;
  private evaluating = false;
  private transcriptionCounts = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, participant_id TEXT NOT NULL)`);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS traces (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL)`,
    );
    this.room = ctx.storage.kv.get<RoomState>("room") ?? null;
  }

  // ---------- RPC ----------

  async create(args: {
    roomId: string;
    host: JoinBody;
    config: RoomConfig;
    method: DecisionMethod;
  }): Promise<RpcResult<{ participantId: string; token: string }>> {
    if (this.room) return { ok: false, code: "exists", message: "Room id collision." };
    try {
      const participantId = randomId(8);
      const room = createRoom({
        id: args.roomId,
        host: this.joinInput(participantId, args.host, 0),
        config: args.config,
        method: args.method,
        now: Date.now(),
      });
      const token = await this.issueToken(participantId);
      this.save(room);
      return { ok: true, value: { participantId, token } };
    } catch (e) {
      return errorResult(e);
    }
  }

  async join(body: JoinBody): Promise<RpcResult<{ participantId: string; token: string }>> {
    const room = this.room;
    if (!room) return { ok: false, code: "not_found", message: "Room not found." };
    try {
      const participantId = randomId(8);
      const next = join(room, this.joinInput(participantId, body, room.participants.length), Date.now());
      const token = await this.issueToken(participantId);
      this.save(next);
      return { ok: true, value: { participantId, token } };
    } catch (e) {
      return errorResult(e);
    }
  }

  async peek(): Promise<RoomPeek | null> {
    const room = this.room;
    if (!room || Date.now() >= room.expiresAt) return null;
    const host = room.participants.find((p) => p.isHost);
    return {
      roomId: room.id,
      phase: room.phase,
      hostName: host?.name ?? "",
      diningAt: room.config.diningAt,
      meetingAreaId: room.config.meetingAreaId,
      dinerCount: room.participants.length,
      joinable: room.phase === "LOBBY" && room.participants.length < 6,
    };
  }

  async view(token: string): Promise<RpcResult<RoomView>> {
    const pid = await this.authenticate(token);
    if (!pid || !this.room) return { ok: false, code: "forbidden", message: "Not a member of this room." };
    return { ok: true, value: this.viewFor(pid) };
  }

  async action(token: string, body: ActionBody): Promise<RpcResult<RoomView>> {
    const pid = await this.authenticate(token);
    const room = this.room;
    if (!pid || !room) return { ok: false, code: "forbidden", message: "Not a member of this room." };
    const now = Date.now();
    try {
      let next = tick(room, now);
      switch (body.type) {
        case "start":
          next = start(next, pid, now);
          break;
        case "remove":
          next = removeParticipant(next, pid, body.targetId, now);
          this.dropParticipant(body.targetId);
          break;
        case "submit":
          next = submit(
            next,
            pid,
            {
              kind: body.kind,
              text: body.text,
              source: body.source,
              idempotencyKey: body.idempotencyKey,
              ...(body.choiceId ? { choiceId: body.choiceId } : {}),
            },
            now,
          );
          break;
        case "retry":
          next = retry(next, pid, now);
          if (next !== room) this.trace("retry_requested", { by: "participant" });
          break;
      }
      this.save(next);
      return { ok: true, value: this.viewFor(pid) };
    } catch (e) {
      return errorResult(e);
    }
  }

  async transcribeAudio(
    token: string,
    args: { kind: SubmissionKind; mode: "draft" | "direct"; audio: ArrayBuffer; contentType: string },
  ): Promise<RpcResult<TranscribeResponse>> {
    const pid = await this.authenticate(token);
    if (!pid || !this.room) return { ok: false, code: "forbidden", message: "Not a member of this room." };
    if (args.audio.byteLength === 0 || args.audio.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false, code: "invalid_input", message: "Recording is empty or too long." };
    }
    const room = tick(this.room, Date.now());
    if (room !== this.room) this.save(room);
    if (!isInputPhase(room.phase) || INPUT_PHASE_KIND[room.phase] !== args.kind || !requiredResponders(room).includes(pid)) {
      return { ok: false, code: "wrong_phase", message: "That step has closed." };
    }
    const countKey = `${pid}:${room.evaluationSeq}:${room.phase}`;
    const count = this.transcriptionCounts.get(countKey) ?? 0;
    if (count >= MAX_TRANSCRIPTIONS_PER_PHASE) {
      return { ok: false, code: "rate_limited", message: "Too many recordings — try typing instead." };
    }
    this.transcriptionCounts.set(countKey, count + 1);

    if (args.mode === "draft") {
      if (room.deadline !== null && Date.now() > room.deadline) {
        return { ok: false, code: "deadline_passed", message: "Time's up for this step." };
      }
      try {
        const transcript = await this.runTranscription(args.audio, args.contentType, TRANSCRIPTION_GRACE_MS);
        if (!transcript) return { ok: false, code: "empty_transcript", message: "We couldn't hear anything. Try again or type it." };
        return { ok: true, value: { mode: "draft", transcript } };
      } catch {
        return { ok: false, code: "transcription_failed", message: "Transcription failed. Your draft is still here — try typing." };
      }
    }

    const id = randomId(10);
    try {
      this.save(ackTranscription(room, pid, { id, kind: args.kind }, Date.now()));
    } catch (e) {
      return errorResult(e);
    }
    let transcript: string | null = null;
    try {
      transcript = await this.runTranscription(args.audio, args.contentType, TRANSCRIPTION_GRACE_MS);
    } catch (e) {
      this.trace("transcription_failed", { pid, error: (e as Error).message });
    }
    const resolved = resolveTranscription(this.room!, pid, { id, text: transcript }, Date.now());
    this.save(resolved.state);
    return {
      ok: true,
      value: {
        mode: "direct",
        accepted: resolved.accepted,
        transcript,
        ...(resolved.reason ? { reason: resolved.reason } : {}),
      },
    };
  }

  // ---------- WebSockets (hibernatable) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(null satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 2000) return;
    let msg: { type?: string; token?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type === "auth" && typeof msg.token === "string") {
      const pid = await this.authenticate(msg.token);
      if (!pid || !this.room) {
        ws.close(4001, "unauthorized");
        return;
      }
      ws.serializeAttachment({ pid } satisfies SocketAttachment);
      this.send(ws, pid);
    } else if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", serverNow: Date.now() }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // already closed
    }
  }

  // ---------- Alarms: deadlines, evaluation, expiry ----------

  async alarm() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (now >= room.expiresAt) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4000, "expired");
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    let next = tick(room, now);
    if (next.opError && next.opError.attempts < MAX_AUTO_ATTEMPTS && now >= next.opError.at + AUTO_RETRY_DELAY_MS) {
      this.trace("auto_retry", { attempts: next.opError.attempts });
      next = { ...next, opError: null };
    }
    this.save(next);
    if (isProcessingPhase(next.phase) && !next.opError) await this.evaluate();
  }

  private async evaluate() {
    if (this.evaluating || !this.room) return;
    this.evaluating = true;
    const snapshot = this.room;
    const seq = snapshot.evaluationSeq;
    const ai = bindingClient(this.env, { roomId: snapshot.id, method: snapshot.method });
    const started = Date.now();
    try {
      const outcome = await selectPipeline(this.env, snapshot.method)({
        state: snapshot,
        now: started,
        ai,
        trace: (kind, data) => this.trace(kind, data),
      });
      this.trace("outcome", { phase: snapshot.phase, seq, kind: outcome.kind, ms: Date.now() - started });
      this.save(applyOutcome(this.room!, outcome, seq, Date.now()));
    } catch (e) {
      if (e instanceof MachineError && e.code === "stale_evaluation") return;
      const message = e instanceof Error ? e.message : String(e);
      this.trace("evaluation_failed", { phase: snapshot.phase, seq, message, ms: Date.now() - started });
      this.save(failEvaluation(this.room!, message, seq, Date.now()));
    } finally {
      if (ai.calls.length) this.trace("ai_calls", ai.calls);
      this.evaluating = false;
    }
  }

  // ---------- internals ----------

  private joinInput(participantId: string, body: JoinBody, joinIndex: number) {
    const profileId = body.profileId && profile(body.profileId) ? body.profileId : defaultProfileId(joinIndex);
    return {
      id: participantId,
      name: body.name,
      profileId,
      startAreaId: body.startAreaId ?? null,
      startLatLng: body.startLatLng ?? null,
    };
  }

  private async issueToken(participantId: string): Promise<string> {
    const token = newToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO tokens (hash, participant_id) VALUES (?, ?)",
      await hashToken(token),
      participantId,
    );
    return token;
  }

  private async authenticate(token: string): Promise<string | null> {
    if (!token || token.length > 100) return null;
    const rows = this.ctx.storage.sql
      .exec<{ participant_id: string }>("SELECT participant_id FROM tokens WHERE hash = ?", await hashToken(token))
      .toArray();
    const pid = rows[0]?.participant_id;
    return pid && this.room?.participants.some((p) => p.id === pid) ? pid : null;
  }

  private dropParticipant(pid: string) {
    this.ctx.storage.sql.exec("DELETE FROM tokens WHERE participant_id = ?", pid);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as SocketAttachment)?.pid === pid) ws.close(4003, "removed");
    }
  }

  private async runTranscription(audio: ArrayBuffer, contentType: string, timeoutMs: number) {
    if (this.env.PROVIDER_MODE !== "live") return FIXTURE_TRANSCRIPT;
    const ai = bindingClient(this.env, { roomId: this.room?.id ?? "", purpose: "transcription" });
    try {
      return await transcribe(ai, audio, contentType, timeoutMs);
    } finally {
      this.trace("ai_calls", ai.calls);
    }
  }

  private trace(kind: string, data: unknown) {
    this.ctx.storage.sql.exec(
      "INSERT INTO traces (at, kind, data) VALUES (?, ?, ?)",
      Date.now(),
      kind,
      JSON.stringify(data),
    );
  }

  private viewFor(pid: string): RoomView {
    return toView(this.room!, pid, Date.now(), this.env.PROVIDER_MODE !== "live");
  }

  private send(ws: WebSocket, pid: string) {
    try {
      ws.send(JSON.stringify({ type: "view", view: this.viewFor(pid) }));
    } catch {
      // socket closed between listing and sending
    }
  }

  /** Persist, notify connected participants, and schedule the next wake-up. */
  private save(next: RoomState) {
    const changed = next !== this.room;
    this.room = next;
    this.ctx.storage.kv.put("room", next);
    if (changed) {
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as SocketAttachment;
        if (att?.pid && next.participants.some((p) => p.id === att.pid)) this.send(ws, att.pid);
      }
    }
    void this.schedule(next);
  }

  private async schedule(room: RoomState) {
    const now = Date.now();
    const candidates = [room.expiresAt];
    const wake = nextWakeAt(room);
    if (wake !== null) candidates.push(wake);
    if (isProcessingPhase(room.phase)) {
      if (!room.opError) candidates.push(now);
      else if (room.opError.attempts < MAX_AUTO_ATTEMPTS) candidates.push(room.opError.at + AUTO_RETRY_DELAY_MS);
    }
    const at = Math.min(...candidates);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current < now - 1000) await this.ctx.storage.setAlarm(at);
  }

  /** Debug/experiment access to the room's decision trace. */
  async traces(): Promise<{ at: number; kind: string; data: unknown }[]> {
    return this.ctx.storage.sql
      .exec<{ at: number; kind: string; data: string }>("SELECT at, kind, data FROM traces ORDER BY seq")
      .toArray()
      .map((r) => ({ at: r.at, kind: r.kind, data: JSON.parse(r.data) }));
  }
}
