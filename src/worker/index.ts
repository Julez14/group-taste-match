import { ActionBody, CreateRoomBody, JoinBody } from "../shared/api";
import { meetingArea } from "../shared/data";
import { nyLocalToIso } from "../shared/time";
import type { DecisionMethod, SubmissionKind } from "../shared/types";
import type { Room, RpcResult } from "./room";
import { devRoute } from "./dev-routes";
import { randomId, ROOM_ID_RE } from "./tokens";

export { Room } from "./room";

const devRoutesOn = (env: Env) => (env as { DEV_ROUTES?: string }).DEV_ROUTES === "on";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

const apiError = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  wrong_phase: 409,
  room_full: 409,
  too_few_diners: 409,
  deadline_passed: 409,
  illegal_action: 409,
  expired: 410,
  invalid_input: 400,
  empty_transcript: 422,
  transcription_failed: 502,
  rate_limited: 429,
};

function fromRpc<T>(r: RpcResult<T>): Response {
  return r.ok ? json(r.value) : apiError(STATUS[r.code] ?? 500, r.code, r.message);
}

const bearer = (req: Request) => req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";

async function parse<T>(req: Request, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }) {
  if (Number(req.headers.get("Content-Length") ?? 0) > 16_000) return null;
  const body = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

async function limited(env: Env, key: string): Promise<boolean> {
  const { success } = await env.CREATE_LIMITER.limit({ key });
  return !success;
}

function stub(env: Env, roomId: string): DurableObjectStub<Room> {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

const decisionMethod = (env: Env): DecisionMethod => (env.DECISION_METHOD === "llm_baseline" ? "llm_baseline" : "clef");

async function createRoom(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  if (await limited(env, `create:${ip}`)) return apiError(429, "rate_limited", "Too many rooms — try again in a minute.");
  const body = await parse(req, CreateRoomBody);
  if (!body) return apiError(400, "invalid_input", "Please check the meeting details.");
  if (!meetingArea(body.config.meetingAreaId)) return apiError(400, "invalid_input", "Unknown meeting area.");
  if (body.host.startAreaId && !meetingArea(body.host.startAreaId)) {
    return apiError(400, "invalid_input", "Unknown starting area.");
  }
  let diningAt: string;
  try {
    diningAt = nyLocalToIso(body.config.date, body.config.time);
  } catch {
    return apiError(400, "invalid_input", "Invalid date or time.");
  }
  const t = Date.parse(diningAt);
  if (t < Date.now() - 3600_000 || t > Date.now() + 14 * 86400_000) {
    return apiError(400, "invalid_input", "Pick a time within the next two weeks.");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const roomId = randomId(10);
    const r = await stub(env, roomId).create({
      roomId,
      host: body.host,
      config: { diningAt, meetingAreaId: body.config.meetingAreaId, timers: body.config.timers },
      method: body.debugMethod && devRoutesOn(env) ? body.debugMethod : decisionMethod(env),
    });
    if (r.ok) return json({ roomId, ...r.value }, 201);
    if (r.code !== "exists") return fromRpc(r);
  }
  return apiError(500, "internal", "Could not create a room.");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/rooms" && req.method === "POST") return createRoom(req, env);
    const exp = /^\/api\/__exp\/([a-z]+)$/.exec(url.pathname);
    if (exp && req.method === "POST") {
      if (!devRoutesOn(env)) return apiError(404, "not_found", "Not found.");
      return devRoute(req, env, exp[1]!);
    }

    const m = /^\/api\/rooms\/([^/]+)(?:\/(join|action|transcribe|ws|view|traces))?$/.exec(url.pathname);
    if (!m) return apiError(404, "not_found", "Not found.");
    const roomId = m[1]!;
    if (!ROOM_ID_RE.test(roomId)) return apiError(404, "not_found", "Room not found.");
    const room = stub(env, roomId);
    const route = m[2];

    if (!route && req.method === "GET") {
      const peek = await room.peek();
      return peek ? json(peek) : apiError(404, "not_found", "This room doesn't exist or has expired.");
    }
    if (route === "ws") return room.fetch(req);
    if (route === "join" && req.method === "POST") {
      const ip = req.headers.get("CF-Connecting-IP") ?? "local";
      if (await limited(env, `join:${ip}`)) return apiError(429, "rate_limited", "Too many requests.");
      const body = await parse(req, JoinBody);
      if (!body) return apiError(400, "invalid_input", "Please enter your name.");
      if (body.startAreaId && !meetingArea(body.startAreaId)) {
        return apiError(400, "invalid_input", "Unknown starting area.");
      }
      const r = await room.join(body);
      return r.ok ? json({ roomId, ...r.value }, 201) : fromRpc(r);
    }
    if (route === "view" && req.method === "GET") return fromRpc(await room.view(bearer(req)));
    if (route === "traces" && req.method === "GET") {
      // Local debugging only; never set DEV_ROUTES in deployed config.
      if (!devRoutesOn(env)) return apiError(404, "not_found", "Not found.");
      return json(await room.traces());
    }
    if (route === "action" && req.method === "POST") {
      const body = await parse(req, ActionBody);
      if (!body) return apiError(400, "invalid_input", "Invalid request.");
      return fromRpc(await room.action(bearer(req), body));
    }
    if (route === "transcribe" && req.method === "POST") {
      const kind = url.searchParams.get("kind") as SubmissionKind;
      const mode = url.searchParams.get("mode");
      if (!["initial", "clarify", "host"].includes(kind) || (mode !== "draft" && mode !== "direct")) {
        return apiError(400, "invalid_input", "Invalid request.");
      }
      const contentType = (req.headers.get("Content-Type") ?? "audio/webm").split(";")[0]!.trim();
      if (!/^audio\/[a-z0-9.+-]+$/.test(contentType)) return apiError(415, "invalid_input", "Unsupported audio.");
      const audio = await req.arrayBuffer();
      return fromRpc(await room.transcribeAudio(bearer(req), { kind, mode, audio, contentType }));
    }
    return apiError(405, "not_found", "Method not allowed.");
  },
} satisfies ExportedHandler<Env>;
