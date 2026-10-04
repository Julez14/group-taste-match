import { useState } from "react";
import { meetingArea } from "../../shared/data";
import { formatDiningTime } from "../../shared/time";
import { MAX_DINERS, MIN_DINERS } from "../../shared/types";
import type { RoomView } from "../../shared/view";
import { ApiError } from "../api";
import { TopBar, useToast } from "../ui/Chrome";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

export function Lobby({ view, act }: { view: RoomView; act: (body: { type: "start" } | { type: "remove"; targetId: string }) => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const link = `${location.origin}/r/${view.roomId}`;
  const area = meetingArea(view.config.meetingAreaId);
  const count = view.participants.length;
  const host = view.participants.find((p) => p.isHost);

  const share = async () => {
    const text = `Help pick dinner — ${formatDiningTime(view.config.diningAt)} near ${area?.name}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join my dinner group", text, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast("Invite link copied");
      }
    } catch {
      // share sheet dismissed
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied");
    } catch {
      toast("Couldn't copy — long-press the link instead");
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      await act({ type: "start" });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't start.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar
        brand
        right={
          <button className="icon-btn" onClick={share} aria-label="Share invite">
            <Icon name="share" />
          </button>
        }
      />
      <div className="screen">
        <h1 className="display" style={{ marginTop: 12 }}>
          {view.me.isHost ? "Invite your group" : "You're in!"}
        </h1>
        <p className="subtle">
          {formatDiningTime(view.config.diningAt)} · near {area?.name}
        </p>

        {view.me.isHost && (
          <div className="stack" style={{ gap: 10 }}>
            <button className="menu-card" onClick={share}>
              <span className="menu-icon" style={{ background: "#4f8ff7" }}>
                <Icon name="share" size={17} />
              </span>
              <span style={{ flex: 1 }}>Share your invite link</span>
              <Icon name="chevron" size={18} />
            </button>
            <button className="menu-card" onClick={copy}>
              <span className="menu-icon" style={{ background: "#43c463" }}>
                <Icon name="link" size={17} />
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.replace(/^https?:\/\//, "")}</span>
              <span className="caption">Copy</span>
            </button>
          </div>
        )}

        <div className="section-label">
          Who's coming · {count}/{MAX_DINERS}
        </div>
        <ul className="list">
          {view.participants.map((p) => (
            <li key={p.id} className="list-row" style={{ cursor: "default" }}>
              <Avatar name={p.name} seed={p.id} />
              <div className="grow">
                <div className="title">
                  {p.name}
                  {p.id === view.me.id && <span className="caption"> (you)</span>}
                </div>
                {p.isHost && <div className="meta">Host</div>}
              </div>
              {view.me.isHost && !p.isHost && (
                <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => act({ type: "remove", targetId: p.id }).catch(() => toast("Couldn't remove."))}>
                  <Icon name="close" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="spacer" />
        {view.me.isHost ? (
          <div className="stack" style={{ alignItems: "center", marginTop: 20 }}>
            <button className="btn btn-primary" disabled={count < MIN_DINERS || busy} onClick={start}>
              {count < MIN_DINERS ? "Waiting for someone to join" : `Start with ${count}`}
            </button>
            <p className="caption">Once you start, the group is locked and the clock begins.</p>
          </div>
        ) : (
          <p className="caption" style={{ textAlign: "center" }}>
            Waiting for {host?.name ?? "the host"} to start…
          </p>
        )}
      </div>
    </>
  );
}
