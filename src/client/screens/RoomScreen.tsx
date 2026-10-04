import { useCallback, useState } from "react";
import type { ActionBody } from "../../shared/api";
import { api, ApiError, type Session, sessions } from "../api";
import { navigate } from "../router";
import { useRoom } from "../useRoom";
import { TopBar, useToast } from "../ui/Chrome";
import { EmptyTableIllustration } from "../ui/Illustrations";
import { JoinFlow } from "./JoinFlow";
import { Lobby } from "./Lobby";
import { Respond } from "./Respond";
import { NoMatchScreen, Result } from "./Result";
import { Waiting } from "./Waiting";

export function RoomScreen({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<Session | null>(() => sessions.get(roomId));
  if (!session) return <JoinFlow roomId={roomId} onJoined={setSession} />;
  return <InRoom roomId={roomId} session={session} onLeave={() => { sessions.clear(roomId); setSession(null); }} />;
}

function InRoom({ roomId, session, onLeave }: { roomId: string; session: Session; onLeave: () => void }) {
  const toast = useToast();
  const { view, offset, error, apply } = useRoom(roomId, session);
  const [retrying, setRetrying] = useState(false);

  const act = useCallback(
    async (body: ActionBody) => {
      apply(await api.action(roomId, session.token, body));
    },
    [roomId, session.token, apply],
  );

  if (error && !view) {
    return (
      <>
        <TopBar brand />
        <div className="screen screen-center">
          <EmptyTableIllustration />
          <h1 className="display">{error.status === 403 ? "You're not in this group" : "This group isn't available"}</h1>
          <p className="subtle">{error.message}</p>
          <div className="spacer" />
          {error.status === 403 ? (
            <button className="btn btn-primary" onClick={onLeave}>
              Join again
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate("/")}>
              Start a new group
            </button>
          )}
        </div>
      </>
    );
  }
  if (!view) return <TopBar brand />;

  const retry = async () => {
    setRetrying(true);
    try {
      await act({ type: "retry" });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't retry.");
    } finally {
      setRetrying(false);
    }
  };

  const voice = (_kind: "initial" | "clarify" | "host") => undefined;

  switch (view.phase) {
    case "LOBBY":
      return <Lobby view={view} act={act} />;
    case "COLLECTING":
      return <Respond key="initial" view={view} offset={offset} kind="initial" act={act} voice={voice("initial")} />;
    case "CLARIFYING":
      return view.needsMyInput ? (
        <Respond key="clarify" view={view} offset={offset} kind="clarify" act={act} voice={voice("clarify")} />
      ) : (
        <Waiting view={view} onRetry={retry} retrying={retrying} />
      );
    case "HOST_FINAL_CALL":
      return view.needsMyInput ? (
        <Respond key="host" view={view} offset={offset} kind="host" act={act} voice={voice("host")} />
      ) : (
        <Waiting view={view} onRetry={retry} retrying={retrying} />
      );
    case "RESULT":
      return view.result ? <Result card={view.result} fixtureMode={view.fixtureMode} /> : null;
    case "NO_FEASIBLE_MATCH":
      return view.noMatch ? <NoMatchScreen noMatch={view.noMatch} /> : null;
    default:
      return <Waiting view={view} onRetry={retry} retrying={retrying} />;
  }
}
