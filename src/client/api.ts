import type { ActionBody, CreateRoomBody, JoinBody, JoinResponse, RoomPeek, TranscribeResponse } from "../shared/api";
import type { SubmissionKind } from "../shared/types";
import type { RoomView } from "../shared/view";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network", "You seem to be offline. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? "Something went wrong.");
  }
  return data as T;
}

const jsonInit = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

export type Session = { participantId: string; token: string };

const key = (roomId: string) => `gtm:session:${roomId}`;

export const sessions = {
  get(roomId: string): Session | null {
    try {
      return JSON.parse(localStorage.getItem(key(roomId)) ?? "null");
    } catch {
      return null;
    }
  },
  set(roomId: string, s: Session) {
    localStorage.setItem(key(roomId), JSON.stringify(s));
  },
  clear(roomId: string) {
    localStorage.removeItem(key(roomId));
  },
};

export const api = {
  createRoom: (body: CreateRoomBody) => request<JoinResponse>("/api/rooms", jsonInit(body)),
  peek: (roomId: string) => request<RoomPeek>(`/api/rooms/${roomId}`),
  join: (roomId: string, body: JoinBody) => request<JoinResponse>(`/api/rooms/${roomId}/join`, jsonInit(body)),
  view: (roomId: string, token: string) =>
    request<RoomView>(`/api/rooms/${roomId}/view`, { headers: { Authorization: `Bearer ${token}` } }),
  action: (roomId: string, token: string, body: ActionBody) =>
    request<RoomView>(`/api/rooms/${roomId}/action`, jsonInit(body, token)),
  transcribe: (roomId: string, token: string, kind: SubmissionKind, mode: "draft" | "direct", audio: Blob) =>
    request<TranscribeResponse>(`/api/rooms/${roomId}/transcribe?kind=${kind}&mode=${mode}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": audio.type || "audio/webm" },
      body: audio,
    }),
};
