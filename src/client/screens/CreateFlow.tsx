import { useMemo, useState } from "react";
import { defaultProfileId, meetingArea } from "../../shared/data";
import { formatDiningTime, nyLocalToIso, nyParts, suggestDiningTime } from "../../shared/time";
import { DEFAULT_TIMERS, TIMER_OPTIONS, type Timers } from "../../shared/types";
import { api, ApiError, sessions } from "../api";
import { navigate } from "../router";
import { TopBar, useToast } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { MapPinIllustration } from "../ui/Illustrations";
import { AreaList, NameField, type Origin, OriginPicker, ProfilePicker, StepScreen } from "./steps";

type Step = "welcome" | "name" | "profile" | "when" | "where" | "review";
const ORDER: Step[] = ["welcome", "name", "profile", "when", "where", "review"];

function upcomingDays(now: number, count: number) {
  const p = nyParts(now);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + i, 12));
    const iso = d.toISOString().slice(0, 10);
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
    return { iso, label };
  });
}

const TIMES = Array.from({ length: 23 }, (_, i) => {
  const mins = 11 * 60 + 30 + i * 30;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
});

const timeLabel = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function CreateFlow() {
  const toast = useToast();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [profileId, setProfileId] = useState(defaultProfileId(0));
  const suggested = useMemo(() => suggestDiningTime(Date.now()), []);
  const [date, setDate] = useState(suggested.date);
  const [time, setTime] = useState(suggested.time);
  const [areaId, setAreaId] = useState<string | null>("union-square");
  const [timers, setTimers] = useState<Timers>(DEFAULT_TIMERS);
  const [origin, setOrigin] = useState<Origin>({ startAreaId: null, startLatLng: null });
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => upcomingDays(Date.now(), 14), []);

  const go = (delta: number) => setStep(ORDER[Math.max(0, ORDER.indexOf(step) + delta)]!);
  const back = () => go(-1);
  const isPast = Date.parse(nyLocalToIso(date, time)) < Date.now() - 15 * 60_000;

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.createRoom({
        host: { name, profileId, startAreaId: origin.startAreaId, startLatLng: origin.startLatLng },
        config: { date, time, meetingAreaId: areaId!, timers },
      });
      sessions.set(res.roomId, { participantId: res.participantId, token: res.token });
      navigate(`/r/${res.roomId}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't create the group.");
      setBusy(false);
    }
  };

  switch (step) {
    case "welcome":
      return (
        <>
          <TopBar brand />
          <div className="screen screen-center">
            <MapPinIllustration />
            <h1 className="display" style={{ marginTop: 12 }}>
              Pick a spot, together
            </h1>
            <p className="subtle">
              Start a group, everyone says what they're craving, and we'll choose one restaurant that works for all of you.
            </p>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => go(1)}>
              Start a group
            </button>
            <p className="caption" style={{ marginTop: 14 }}>
              For 2–6 diners in New York City
            </p>
          </div>
        </>
      );
    case "name":
      return (
        <StepScreen title="What's your name?" subtitle="This is how your friends will see you!" onBack={back} cta="Continue" ctaDisabled={!name.trim()} onCta={() => go(1)}>
          <NameField value={name} onChange={setName} />
        </StepScreen>
      );
    case "profile":
      return (
        <StepScreen
          title="Pick a taste profile"
          subtitle="Demo profiles stand in for your Beli lists. We picked one for you."
          onBack={back}
          cta="Continue"
          onCta={() => go(1)}
        >
          <ProfilePicker value={profileId} onChange={setProfileId} />
        </StepScreen>
      );
    case "when":
      return (
        <StepScreen
          title="When are you eating?"
          subtitle="We suggested a time — confirm it or pick another."
          onBack={back}
          cta="Confirm time"
          ctaDisabled={isPast}
          onCta={() => go(1)}
        >
          <div className="section-label">Day</div>
          <div className="circles" style={{ overflowX: "auto", paddingBottom: 6 }} role="radiogroup" aria-label="Day">
            {days.map((d) => (
              <button key={d.iso} type="button" className="circle-opt" aria-pressed={date === d.iso} onClick={() => setDate(d.iso)} style={{ whiteSpace: "nowrap" }}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="section-label">Time</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }} role="radiogroup" aria-label="Time">
            {TIMES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={time === t}
                className={`slot${time === t ? "" : " slot-muted"}`}
                style={{ border: 0, minWidth: 0, height: 40, cursor: "pointer" }}
                onClick={() => setTime(t)}
              >
                {timeLabel(t)}
              </button>
            ))}
          </div>
          {isPast && <p className="caption" style={{ color: "var(--danger)" }}>That time has already passed.</p>}
        </StepScreen>
      );
    case "where":
      return (
        <StepScreen
          title="Where are you meeting?"
          subtitle="We'll estimate everyone's trip from here unless they tell us otherwise."
          onBack={back}
          cta="Confirm area"
          ctaDisabled={!areaId}
          onCta={() => go(1)}
        >
          <AreaList value={areaId} onChange={setAreaId} />
        </StepScreen>
      );
    case "review": {
      const area = meetingArea(areaId!);
      return (
        <ReviewStep
          onBack={back}
          when={formatDiningTime(nyLocalToIso(date, time))}
          areaName={area?.name ?? ""}
          timers={timers}
          setTimers={setTimers}
          origin={origin}
          setOrigin={setOrigin}
          busy={busy}
          onCreate={create}
        />
      );
    }
  }
}

function ReviewStep(props: {
  onBack: () => void;
  when: string;
  areaName: string;
  timers: Timers;
  setTimers: (t: Timers) => void;
  origin: Origin;
  setOrigin: (o: Origin) => void;
  busy: boolean;
  onCreate: () => void;
}) {
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const { timers, setTimers } = props;
  if (pickingOrigin) {
    return (
      <StepScreen title="Where are you coming from?" subtitle="Optional. Only used to estimate your trip — never shown to the group." onBack={() => setPickingOrigin(false)} cta="Done" onCta={() => setPickingOrigin(false)}>
        <OriginPicker meetingAreaName={props.areaName} value={props.origin} onChange={props.setOrigin} />
      </StepScreen>
    );
  }
  const originLabel = props.origin.startLatLng
    ? "Your approximate location"
    : props.origin.startAreaId
      ? (meetingArea(props.origin.startAreaId)?.name ?? "")
      : "Same as meeting area";
  const timerRow = (label: string, key: keyof Timers, options: readonly number[]) => (
    <div style={{ marginBottom: 14 }}>
      <div className="caption" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div className="circles" role="radiogroup" aria-label={label}>
        {options.map((s) => (
          <button key={s} type="button" className="circle-opt" aria-pressed={timers[key] === s} onClick={() => setTimers({ ...timers, [key]: s } as Timers)}>
            {s}s
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <StepScreen title="Look good?" onBack={props.onBack} cta="Create group" busy={props.busy} onCta={props.onCreate}>
      <div className="card stack" style={{ gap: 14 }}>
        <div className="row">
          <Icon name="calendar" />
          <div style={{ flex: 1 }}>{props.when}</div>
        </div>
        <div className="row">
          <Icon name="pin" />
          <div style={{ flex: 1 }}>Meeting near {props.areaName}</div>
        </div>
        <button type="button" className="row" style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => setPickingOrigin(true)}>
          <Icon name="directions" />
          <div style={{ flex: 1 }}>
            Coming from: <strong>{originLabel}</strong>
          </div>
          <Icon name="chevron" size={18} />
        </button>
      </div>
      <div className="section-label">Timers</div>
      {timerRow("Everyone shares what they want", "initialSec", TIMER_OPTIONS.initialSec)}
      {timerRow("Quick follow-up question", "clarifySec", TIMER_OPTIONS.clarifySec)}
      {timerRow("Your final call, if needed", "hostSec", TIMER_OPTIONS.hostSec)}
      <p className="caption">Timers lock once you start.</p>
    </StepScreen>
  );
}
