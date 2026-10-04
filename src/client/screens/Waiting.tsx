import type { RoomView } from "../../shared/view";
import { TopBar } from "../ui/Chrome";
import { ThinkingIllustration } from "../ui/Illustrations";

const MESSAGES: Record<string, { title: string; body: string }> = {
  EVALUATING: { title: "Finding a spot for everyone", body: "Weighing what everyone said against real menus, prices, and travel." },
  CLARIFYING: { title: "We're checking a couple of details", body: "Hang tight — this only takes a moment." },
  REEVALUATING: { title: "Almost there", body: "Rechecking the shortlist." },
  HOST_FINAL_CALL: { title: "We're checking a couple of details", body: "Hang tight — this only takes a moment." },
  FINALIZING: { title: "Locking in your spot", body: "Double-checking hours and availability." },
  COLLECTING: { title: "Waiting for the group", body: "We'll start as soon as everyone's in, or when time's up." },
};

export function Waiting({ view, onRetry, retrying }: { view: RoomView; onRetry: () => void; retrying: boolean }) {
  const msg = MESSAGES[view.phase] ?? MESSAGES.EVALUATING!;
  return (
    <>
      <TopBar brand />
      <div className="screen screen-center" aria-live="polite">
        <ThinkingIllustration />
        {view.error ? (
          <>
            <h1 className="display">We hit a snag</h1>
            <p className="subtle">{view.error.message}</p>
            <button className="btn btn-primary" onClick={onRetry} disabled={retrying} style={{ maxWidth: 260, alignSelf: "center" }}>
              {retrying ? "Trying again…" : "Try again"}
            </button>
          </>
        ) : (
          <>
            <h1 className="display">{msg.title}</h1>
            <p className="subtle">{msg.body}</p>
            <div className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </>
        )}
      </div>
    </>
  );
}
