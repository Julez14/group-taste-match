import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { RoomView } from "../src/shared/view";
import type { RoomState } from "../src/shared/types";
import type { Room } from "../src/worker/room";

const BASE = "https://gtm.test";

function tomorrow() {
  const d = new Date(Date.now() + 86400_000);
  return d.toISOString().slice(0, 10);
}

async function api(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }
  const res = await exports.default.fetch(`${BASE}${path}`, { method: init.method ?? "GET", headers, body });
  return { status: res.status, data: (await res.json()) as any };
}

const PROCESSING = ["EVALUATING", "REEVALUATING", "FINALIZING"];

/** Fire any due alarm and wait until the room leaves its processing phase or records an error. */
async function settle(roomId: string, token: string): Promise<RoomView> {
  for (let i = 0; i < 50; i++) {
    await runDurableObjectAlarm(roomStub(roomId));
    const v = await view(roomId, token);
    if (!PROCESSING.includes(v.phase) || v.error) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("room did not settle");
}

async function createRoom(hostName = "Hana") {
  const r = await api("/api/rooms", {
    method: "POST",
    body: {
      host: { name: hostName },
      config: { date: tomorrow(), time: "19:30", meetingAreaId: "union-square", timers: { initialSec: 60, clarifySec: 30, hostSec: 15 } },
    },
  });
  expect(r.status).toBe(201);
  return r.data as { roomId: string; participantId: string; token: string };
}

async function joinRoom(roomId: string, name: string) {
  const r = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { name } });
  expect(r.status).toBe(201);
  return r.data as { participantId: string; token: string };
}

const act = (roomId: string, token: string, body: unknown) =>
  api(`/api/rooms/${roomId}/action`, { method: "POST", token, body });

const say = (text: string, kind = "initial") => ({
  type: "submit",
  kind,
  text,
  source: "typed",
  idempotencyKey: crypto.randomUUID(),
});

const roomStub = (roomId: string) => env.ROOM.get(env.ROOM.idFromName(roomId)) as DurableObjectStub<Room>;

async function view(roomId: string, token: string): Promise<RoomView> {
  const r = await api(`/api/rooms/${roomId}/view`, { token });
  expect(r.status).toBe(200);
  return r.data;
}

async function startedRoom(diners = 2) {
  const host = await createRoom();
  const others = [];
  for (let i = 1; i < diners; i++) others.push(await joinRoom(host.roomId, `Diner ${i}`));
  expect((await act(host.roomId, host.token, { type: "start" })).status).toBe(200);
  return { host, others, roomId: host.roomId };
}

describe("room API", () => {
  it("creates a room and exposes a minimal public peek", async () => {
    const host = await createRoom();
    const peek = await api(`/api/rooms/${host.roomId}`);
    expect(peek.data).toMatchObject({ hostName: "Hana", dinerCount: 1, joinable: true, phase: "LOBBY" });
    expect(peek.data.diningAt).toMatch(/T19:30:00-0[45]:00$/);
    expect(JSON.stringify(peek.data)).not.toContain(host.token);
  });

  it("rejects bad meeting details and unknown rooms", async () => {
    const bad = await api("/api/rooms", {
      method: "POST",
      body: { host: { name: "A" }, config: { date: tomorrow(), time: "19:30", meetingAreaId: "atlantis", timers: { initialSec: 90, clarifySec: 45, hostSec: 30 } } },
    });
    expect(bad.status).toBe(400);
    const badTimer = await api("/api/rooms", {
      method: "POST",
      body: { host: { name: "A" }, config: { date: tomorrow(), time: "19:30", meetingAreaId: "soho", timers: { initialSec: 75, clarifySec: 45, hostSec: 30 } } },
    });
    expect(badTimer.status).toBe(400);
    expect((await api("/api/rooms/zzzzzzzzzz")).status).toBe(404);
  });

  it("join links do not confer host privileges", async () => {
    const host = await createRoom();
    const guest = await joinRoom(host.roomId, "Gus");
    const r = await act(host.roomId, guest.token, { type: "start" });
    expect(r.status).toBe(403);
    expect((await act(host.roomId, "not-a-token", { type: "start" })).status).toBe(403);
  });

  it("blocks new diners after start but keeps existing members", async () => {
    const { roomId, others } = await startedRoom(2);
    const late = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: { name: "Late" } });
    expect(late.status).toBe(409);
    expect((await view(roomId, others[0]!.token)).phase).toBe("COLLECTING");
  });

  it("keeps each diner's input private in shared views", async () => {
    const { roomId, host, others } = await startedRoom(3);
    await act(roomId, others[0]!.token, say("No more than $25 including tip, I'm allergic to peanuts"));
    const hostView = await view(roomId, host.token);
    expect(JSON.stringify(hostView)).not.toContain("peanuts");
    expect(hostView.participants.find((p) => p.id === others[0]!.participantId)?.submitted).toBe(true);
    const own = await view(roomId, others[0]!.token);
    expect(own.mySubmission?.text).toContain("peanuts");
  });

  it("evaluates when everyone has submitted and asks private clarifications", async () => {
    const { roomId, host, others } = await startedRoom(3);
    await act(roomId, host.token, say("Anything near Union Square"));
    await act(roomId, others[0]!.token, say("Around $30 #clarify"));
    const last = await act(roomId, others[1]!.token, say("Spicy food please"));
    expect(last.data.phase).toBe("EVALUATING");

    const asked = await settle(roomId, others[0]!.token);
    expect(asked.phase).toBe("CLARIFYING");
    expect(asked.myQuestion).toBeTruthy();
    const notAsked = await view(roomId, others[1]!.token);
    expect(notAsked.myQuestion).toBeNull();
    expect(notAsked.needsMyInput).toBe(false);
    expect(notAsked.participants.every((p) => p.submitted === null)).toBe(true);

    const forbidden = await act(roomId, others[1]!.token, say("me too", "clarify"));
    expect(forbidden.status).toBe(403);
    const answered = await act(roomId, others[0]!.token, say("Firm limit, all-in", "clarify"));
    expect(answered.data.phase).toBe("REEVALUATING");
  });

  it("lets only the host answer the final call, once", async () => {
    const { roomId, host, others } = await startedRoom(2);
    await act(roomId, host.token, say("Something nice #host"));
    await act(roomId, others[0]!.token, say("Close to Williamsburg"));
    const hv = await settle(roomId, host.token);
    expect(hv.phase).toBe("HOST_FINAL_CALL");
    expect(hv.hostCall?.options).toHaveLength(2);
    expect((await view(roomId, others[0]!.token)).hostCall).toBeNull();
    const r = await act(roomId, host.token, { ...say("", "host"), choiceId: hv.hostCall!.options[0]!.id });
    expect(r.data.phase).toBe("FINALIZING");
    const done = await settle(roomId, others[0]!.token);
    expect(["RESULT", "NO_FEASIBLE_MATCH"]).toContain(done.phase);
  });

  it("treats provider errors as recoverable and retries with unchanged inputs", async () => {
    const { roomId, host, others } = await startedRoom(2);
    await act(roomId, host.token, say("#error"));
    await act(roomId, others[0]!.token, say("pizza"));
    const v = await settle(roomId, others[0]!.token);
    expect(v.phase).toBe("EVALUATING");
    expect(v.error?.canRetry).toBe(true);
    expect(JSON.stringify(v.error)).not.toContain("Fixture");
    const retried = await act(roomId, others[0]!.token, { type: "retry" });
    expect(retried.status).toBe(200);
    expect(retried.data.error).toBeNull();
    const state = await runInDurableObject(roomStub(roomId), (_i, ctx) => ctx.storage.kv.get<RoomState>("room")!);
    expect(state.clarifyRoundUsed).toBe(false);
    expect(state.evaluationSeq).toBe(1);
  });

  it("closes collection at the server deadline and keeps nonresponders in the party", async () => {
    const { roomId, host } = await startedRoom(3);
    await act(roomId, host.token, say("Tacos"));
    await runInDurableObject(roomStub(roomId), (instance: Room) => {
      const internals = instance as unknown as { room: RoomState; save(s: RoomState): void };
      internals.save({ ...internals.room, deadline: Date.now() - 1 });
    });
    const late = await act(roomId, host.token, say("changed my mind"));
    expect(late.status).toBe(409);
    expect(late.data.error.code).toBe("wrong_phase");
    await settle(roomId, host.token);
    const state = await runInDurableObject(roomStub(roomId), (_i, ctx) => ctx.storage.kv.get<RoomState>("room")!);
    expect(state.partySize).toBe(3);
    expect(Object.keys(state.submissions)).toHaveLength(1);
    expect(["RESULT", "NO_FEASIBLE_MATCH"]).toContain(state.phase);
  });

  it("accepts a direct voice submission in fixture mode and shows the transcript", async () => {
    const { roomId, host } = await startedRoom(2);
    const audio = new Uint8Array(2048).buffer;
    const res = await exports.default.fetch(`${BASE}/api/rooms/${roomId}/transcribe?kind=initial&mode=direct`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}`, "Content-Type": "audio/webm;codecs=opus" },
      body: audio,
    });
    const data = (await res.json()) as any;
    expect(data).toMatchObject({ mode: "direct", accepted: true });
    expect(data.transcript).toContain("Fixture transcript");
    expect((await view(roomId, host.token)).mySubmission?.source).toBe("voice");
  });

  it("pushes personalized views over an authenticated WebSocket", async () => {
    const { roomId, host, others } = await startedRoom(2);
    const res = await exports.default.fetch(`${BASE}/api/rooms/${roomId}/ws`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket!;
    ws.accept();
    const messages: any[] = [];
    const got = (n: number) =>
      new Promise<void>((resolve) => {
        const check = () => (messages.length >= n ? resolve() : setTimeout(check, 10));
        check();
      });
    ws.addEventListener("message", (e) => messages.push(JSON.parse(e.data as string)));
    ws.send(JSON.stringify({ type: "auth", token: host.token }));
    await got(1);
    expect(messages[0].view.me.id).toBe(host.participantId);
    await act(roomId, others[0]!.token, say("dumplings"));
    await got(2);
    expect(messages[1].view.participants.find((p: any) => p.id === others[0]!.participantId).submitted).toBe(true);
    expect(JSON.stringify(messages[1])).not.toContain("dumplings");
    ws.close();
  });
});
