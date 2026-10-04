import { useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SEC, type SubmissionKind } from "../../shared/types";
import { api, ApiError } from "../api";
import { Icon } from "../ui/Icon";

type State =
  | { s: "idle" }
  | { s: "requesting" }
  | { s: "recording"; startedAt: number }
  | { s: "uploading"; mode: "draft" | "direct" }
  | { s: "note"; tone: "info" | "error"; text: string };

const supported = () =>
  typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

function pickMime(): string | undefined {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

export function Voice({
  roomId,
  token,
  kind,
  onDraft,
  refresh,
}: {
  roomId: string;
  token: string;
  kind: SubmissionKind;
  onDraft: (text: string) => void;
  refresh: () => Promise<void>;
}) {
  const [state, setState] = useState<State>(supported() ? { s: "idle" } : { s: "note", tone: "info", text: "Voice isn't available in this browser — type below instead." });
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const modeOnStop = useRef<"draft" | "direct">("draft");
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => () => stopTracks(), []);
  useEffect(() => {
    if (state.s !== "recording") return;
    const id = setInterval(() => {
      const secs = (Date.now() - state.startedAt) / 1000;
      setElapsed(secs);
      if (secs >= MAX_RECORDING_SEC) finish("draft");
    }, 200);
    return () => clearInterval(id);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopTracks() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function begin() {
    setState({ s: "requesting" });
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setState({
        s: "note",
        tone: "error",
        text: denied ? "Microphone access is blocked. You can still type below." : "We couldn't reach your microphone. Type below instead.",
      });
      return;
    }
    const mimeType = pickMime();
    const r = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stopTracks();
      void upload(new Blob(chunks.current, { type: r.mimeType || mimeType || "audio/webm" }), modeOnStop.current);
    };
    rec.current = r;
    r.start(250);
    setElapsed(0);
    setState({ s: "recording", startedAt: Date.now() });
  }

  function finish(mode: "draft" | "direct") {
    modeOnStop.current = mode;
    if (rec.current?.state === "recording") rec.current.stop();
  }

  async function upload(blob: Blob, mode: "draft" | "direct") {
    if (blob.size < 800) {
      setState({ s: "note", tone: "error", text: "That recording was too short. Try again or type below." });
      return;
    }
    setState({ s: "uploading", mode });
    try {
      const res = await api.transcribe(roomId, token, kind, mode, blob);
      if (res.mode === "draft") {
        onDraft(res.transcript);
        setState({ s: "note", tone: "info", text: "Here's what we heard — edit anything, then send." });
        return;
      }
      if (res.accepted) {
        setState({ s: "idle" });
        await refresh().catch(() => {});
        return;
      }
      if (res.transcript) onDraft(res.transcript);
      setState({
        s: "note",
        tone: "error",
        text: res.transcript
          ? "We couldn't send that in time. Your words are below — send them if there's still time."
          : "We couldn't hear anything in that recording. Try again or type below.",
      });
    } catch (e) {
      setState({ s: "note", tone: "error", text: e instanceof ApiError ? e.message : "Couldn't upload your recording. Type below instead." });
    }
  }

  const busy = state.s === "requesting" || state.s === "uploading";
  const recording = state.s === "recording";

  return (
    <div className="voice">
      {recording ? (
        <div className="voice-live" aria-live="polite">
          <div className="voice-pulse">
            <Icon name="mic" size={30} />
          </div>
          <div className="voice-timer">
            {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")} / 1:00
          </div>
          <div className="row" style={{ gap: 10, width: "100%" }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => finish("draft")}>
              <Icon name="stop" size={14} /> Review
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => finish("direct")}>
              <Icon name="send" size={16} /> Send now
            </button>
          </div>
        </div>
      ) : (
        <button className="voice-record" onClick={begin} disabled={busy || (state.s === "note" && !supported())} aria-label="Record by voice">
          <span className="voice-mic">
            <Icon name="mic" size={30} />
          </span>
          <span className="voice-label">
            {state.s === "requesting"
              ? "Allow microphone…"
              : state.s === "uploading"
                ? state.mode === "direct"
                  ? "Sending your recording…"
                  : "Transcribing…"
                : "Tap to talk"}
          </span>
        </button>
      )}
      {state.s === "note" && (
        <p className={`voice-note${state.tone === "error" ? " error" : ""}`} role={state.tone === "error" ? "alert" : "status"}>
          {state.text}
        </p>
      )}
      <div className="voice-or">
        <span>or type it</span>
      </div>
    </div>
  );
}
