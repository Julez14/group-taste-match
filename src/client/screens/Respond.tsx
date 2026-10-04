import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ActionBody } from "../../shared/api";
import { MAX_TEXT_CHARS, type SubmissionKind } from "../../shared/types";
import type { RoomView } from "../../shared/view";
import { ApiError } from "../api";
import { Countdown, TopBar, useToast } from "../ui/Chrome";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

type SubmitBody = Extract<ActionBody, { type: "submit" }>;

export type RespondProps = {
  view: RoomView;
  offset: number;
  kind: SubmissionKind;
  act: (body: SubmitBody) => Promise<void>;
  /** Optional voice capture area rendered above the text box. */
  voice?: (helpers: { setDraft: (t: string) => void; draft: string }) => ReactNode;
};

const COPY: Record<SubmissionKind, { title: string; placeholder: string }> = {
  initial: { title: "Tell us what you're in the mood for.", placeholder: "e.g. Something cozy with vegetarian options, under $40, not too far from the meeting spot" },
  clarify: { title: "Quick question", placeholder: "Type your answer" },
  host: { title: "One last call", placeholder: "Or tell us in your own words" },
};

export function Respond({ view, offset, kind, act, voice }: RespondProps) {
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(!view.mySubmission);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<{ text: string; key: string } | null>(null);
  const submitted = view.mySubmission;

  useEffect(() => {
    if (submitted && !busy) setEditing(false);
  }, [submitted?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string, choiceId?: string) => {
    const payload = `${text}|${choiceId ?? ""}`;
    if (keyRef.current?.text !== payload) keyRef.current = { text: payload, key: crypto.randomUUID() };
    setBusy(true);
    try {
      await act({ type: "submit", kind, text, source: "typed", idempotencyKey: keyRef.current.key, ...(choiceId ? { choiceId } : {}) });
      setEditing(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't send — try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[kind];
  const prompt = kind === "clarify" ? view.myQuestion : kind === "host" ? view.hostCall?.question : null;

  return (
    <>
      <TopBar brand right={view.deadline ? <Countdown deadline={view.deadline} offset={offset} /> : null} />
      <div className="screen">
        <h1 className="display" style={{ marginTop: 12 }}>
          {copy.title}
        </h1>
        {prompt && <p style={{ fontSize: 18, margin: "0 0 18px", lineHeight: 1.4 }}>{prompt}</p>}
        {kind === "initial" && (
          <p className="subtle">Cuisine, budget, vibe, dietary needs, how far you'll travel — whatever matters tonight.</p>
        )}

        {kind === "host" && view.hostCall && view.hostCall.options.length === 2 && !submitted && (
          <HostChoice options={view.hostCall.options} disabled={busy} onPick={(id) => send("", id)} />
        )}

        {submitted && !editing ? (
          <div className="card" style={{ marginTop: 4 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="pill" style={{ background: "var(--success)" }}>
                <Icon name="check" size={14} stroke={3} /> Sent
              </span>
              {submitted.source === "voice" && <span className="caption">from your recording</span>}
            </div>
            <p style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>{submitted.text}</p>
            <button
              className="btn btn-outline btn-small"
              onClick={() => {
                setDraft(submitted.text);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} /> Edit
            </button>
            <p className="caption" style={{ marginTop: 10 }}>
              You can change this until time's up.
            </p>
          </div>
        ) : (
          <>
            {voice?.({ setDraft, draft })}
            <label className="visually-hidden" htmlFor="draft">
              Your answer
            </label>
            <textarea
              id="draft"
              className="textarea"
              placeholder={copy.placeholder}
              maxLength={MAX_TEXT_CHARS}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="caption">{submitted ? "Editing replaces what you sent." : " "}</span>
              <span className="caption">
                {draft.length}/{MAX_TEXT_CHARS}
              </span>
            </div>
          </>
        )}

        {kind === "initial" && <GroupProgress view={view} />}
        <div className="spacer" />
        {(editing || !submitted) && (
          <div className="stack" style={{ marginTop: 16, alignItems: "center" }}>
            <button className="btn btn-primary" disabled={!draft.trim() || busy} onClick={() => send(draft.trim())}>
              {busy ? "Sending…" : submitted ? "Update" : "Send"}
            </button>
            {submitted && (
              <button className="btn btn-text" onClick={() => setEditing(false)}>
                Keep what I sent
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function HostChoice({ options, onPick, disabled }: { options: { id: string; label: string }[]; onPick: (id: string) => void; disabled: boolean }) {
  const option = (o: { id: string; label: string }) => (
    <button
      disabled={disabled}
      onClick={() => onPick(o.id)}
      style={{
        minHeight: 110,
        border: "1.5px solid var(--teal)",
        borderRadius: 12,
        background: "#fff",
        fontFamily: "var(--serif)",
        fontWeight: 700,
        fontSize: 18,
        padding: 10,
        cursor: "pointer",
      }}
    >
      {o.label}
    </button>
  );
  return (
    <div className="card" style={{ marginBottom: 16, padding: 14 }}>
      <div style={{ textAlign: "center", fontWeight: 700, marginBottom: 12 }}>Which do you prefer?</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
        {option(options[0]!)}
        <span className="avatar avatar-sm" style={{ background: "var(--teal)", fontSize: 11 }}>
          OR
        </span>
        {option(options[1]!)}
      </div>
    </div>
  );
}

function GroupProgress({ view }: { view: RoomView }) {
  const done = view.participants.filter((p) => p.submitted).length;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="section-label" style={{ marginTop: 0 }}>
        {done} of {view.participants.length} in
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {view.participants.map((p) => (
          <div key={p.id} style={{ display: "grid", justifyItems: "center", gap: 4, width: 56 }}>
            <Avatar name={p.name} seed={p.id} done={Boolean(p.submitted)} />
            <span className="caption" style={{ maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.id === view.me.id ? "You" : p.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
