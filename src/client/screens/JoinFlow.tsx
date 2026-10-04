import { useEffect, useState } from "react";
import type { RoomPeek } from "../../shared/api";
import { defaultProfileId, meetingArea } from "../../shared/data";
import { formatDiningTime } from "../../shared/time";
import { api, ApiError, type Session, sessions } from "../api";
import { navigate } from "../router";
import { TopBar, useToast } from "../ui/Chrome";
import { Avatar } from "../ui/Avatar";
import { EmptyTableIllustration } from "../ui/Illustrations";
import { NameField, type Origin, OriginPicker, ProfilePicker, StepScreen } from "./steps";

type Step = "invite" | "name" | "profile" | "origin";

export function JoinFlow({ roomId, onJoined }: { roomId: string; onJoined: (s: Session) => void }) {
  const toast = useToast();
  const [peek, setPeek] = useState<RoomPeek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("invite");
  const [name, setName] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>({ startAreaId: null, startLatLng: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.peek(roomId).then(
      (p) => {
        setPeek(p);
        setProfileId((cur) => cur ?? defaultProfileId(p.dinerCount));
      },
      (e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load this group."),
    );
  }, [roomId]);

  if (loadError || (peek && !peek.joinable)) {
    return (
      <>
        <TopBar brand />
        <div className="screen screen-center">
          <EmptyTableIllustration />
          <h1 className="display">{peek ? "This group already started" : "Group not found"}</h1>
          <p className="subtle">{peek ? "New diners can't join once the host starts." : loadError}</p>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Start your own group
          </button>
        </div>
      </>
    );
  }
  if (!peek) return <TopBar brand />;

  const areaName = meetingArea(peek.meetingAreaId)?.name ?? "";

  const join = async (from: Origin = origin) => {
    setBusy(true);
    try {
      const res = await api.join(roomId, { name, profileId: profileId ?? undefined, ...from });
      const s = { participantId: res.participantId, token: res.token };
      sessions.set(roomId, s);
      onJoined(s);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't join.");
      setBusy(false);
    }
  };

  switch (step) {
    case "invite":
      return (
        <>
          <TopBar brand />
          <div className="screen screen-center">
            <h1 className="display" style={{ marginTop: 40 }}>
              You're invited!
            </h1>
            <div style={{ display: "grid", placeItems: "center", margin: "20px 0" }}>
              <span style={{ transform: "scale(2.2)", margin: 30 }}>
                <Avatar name={peek.hostName} />
              </span>
            </div>
            <p style={{ fontSize: 17, margin: "0 0 6px" }}>
              <strong>{peek.hostName}</strong> wants to pick dinner with you.
            </p>
            <p className="subtle">
              {formatDiningTime(peek.diningAt)} · near {areaName}
            </p>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => setStep("name")}>
              Join the group
            </button>
          </div>
        </>
      );
    case "name":
      return (
        <StepScreen title="What's your name?" subtitle="This is how your friends will see you!" onBack={() => setStep("invite")} cta="Continue" ctaDisabled={!name.trim()} onCta={() => setStep("profile")}>
          <NameField value={name} onChange={setName} />
        </StepScreen>
      );
    case "profile":
      return (
        <StepScreen title="Pick a taste profile" subtitle="Demo profiles stand in for your Beli lists. We picked one for you." onBack={() => setStep("name")} cta="Continue" onCta={() => setStep("origin")}>
          <ProfilePicker value={profileId ?? ""} onChange={setProfileId} />
        </StepScreen>
      );
    case "origin":
      return (
        <StepScreen
          title="Where are you coming from?"
          subtitle="Optional. Only used to estimate your trip — never shown to the group."
          onBack={() => setStep("profile")}
          cta="Join"
          busy={busy}
          onCta={() => join()}
          secondary={{ label: "Not now", onClick: () => join({ startAreaId: null, startLatLng: null }) }}
        >
          <OriginPicker meetingAreaName={areaName} value={origin} onChange={setOrigin} />
        </StepScreen>
      );
  }
}
