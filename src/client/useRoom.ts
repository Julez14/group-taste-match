import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomView } from "../shared/view";
import { api, ApiError, type Session } from "./api";

export type RoomConnection = {
  view: RoomView | null;
  /** serverNow - Date.now(), for countdowns against server deadlines. */
  offset: number;
  connected: boolean;
  error: ApiError | null;
  apply: (view: RoomView) => void;
};

/**
 * Live room view over a hibernatable WebSocket, with HTTP polling as a
 * fallback while the socket is down. Reconnects with backoff.
 */
export function useRoom(roomId: string, session: Session | null): RoomConnection {
  const [view, setView] = useState<RoomView | null>(null);
  const [offset, setOffset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const lastNow = useRef(0);

  const apply = useCallback((v: RoomView) => {
    if (v.serverNow < lastNow.current) return;
    lastNow.current = v.serverNow;
    setOffset(v.serverNow - Date.now());
    setView(v);
    setError(null);
  }, []);

  useEffect(() => {
    if (!session) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        apply(await api.view(roomId, session.token));
      } catch (e) {
        if (e instanceof ApiError && e.status !== 0) setError(e);
      }
    };

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/rooms/${roomId}/ws`);
      ws.onopen = () => {
        attempt = 0;
        ws!.send(JSON.stringify({ type: "auth", token: session.token }));
        setConnected(true);
        pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "view") apply(msg.view);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = (e) => {
        setConnected(false);
        clearInterval(pingTimer);
        if (closed) return;
        if (e.code === 4001 || e.code === 4003) {
          setError(new ApiError(403, "forbidden", "You're no longer part of this group."));
          return;
        }
        if (e.code === 4000) {
          setError(new ApiError(410, "expired", "This group has expired."));
          return;
        }
        void poll();
        retryTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt++));
      };
    };

    void poll();
    connect();
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [roomId, session, apply]);

  // Poll while disconnected so deadlines and results still arrive.
  useEffect(() => {
    if (connected || !session) return;
    const id = setInterval(() => {
      api.view(roomId, session.token).then(apply, () => {});
    }, 4000);
    return () => clearInterval(id);
  }, [connected, roomId, session, apply]);

  return { view, offset, connected, error, apply };
}
