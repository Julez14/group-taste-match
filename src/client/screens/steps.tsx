import { type ReactNode, useState } from "react";
import { MEETING_AREAS, PROFILES } from "../../shared/data";
import { TopBar } from "../ui/Chrome";
import { Icon } from "../ui/Icon";

export function StepScreen({
  title,
  subtitle,
  onBack,
  children,
  cta,
  ctaDisabled,
  onCta,
  secondary,
  busy,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  children?: ReactNode;
  cta: string;
  ctaDisabled?: boolean;
  onCta: () => void;
  secondary?: { label: string; onClick: () => void };
  busy?: boolean;
}) {
  return (
    <>
      <TopBar onBack={onBack} />
      <form
        className="screen"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ctaDisabled && !busy) onCta();
        }}
      >
        <h1 className="display">{title}</h1>
        {subtitle && <p className="subtle">{subtitle}</p>}
        {children}
        <div className="spacer" />
        <div className="stack" style={{ marginTop: 24, alignItems: "center" }}>
          <button type="submit" className="btn btn-primary" disabled={ctaDisabled || busy}>
            {busy ? "One sec…" : cta}
          </button>
          {secondary && (
            <button type="button" className="btn btn-text" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

export function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="field-underline"
      autoFocus
      autoComplete="given-name"
      placeholder="First name"
      maxLength={24}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Your name"
    />
  );
}

export function ProfilePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <ul className="list" role="radiogroup" aria-label="Taste profile">
      {PROFILES.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            role="radio"
            aria-checked={value === p.id}
            className={`list-row${value === p.id ? " selected" : ""}`}
            onClick={() => onChange(p.id)}
          >
            <div className="grow">
              <div className="title">{p.label}</div>
              <div className="meta">{p.blurb}</div>
            </div>
            {value === p.id && <Icon name="check" className="check" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AreaList({
  value,
  onChange,
  includeSame,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  includeSame?: string;
}) {
  return (
    <ul className="list" role="radiogroup" aria-label="Neighborhood">
      {includeSame && (
        <li>
          <button type="button" role="radio" aria-checked={value === null} className="list-row" onClick={() => onChange(null)}>
            <div className="grow">
              <div className="title">Same as meeting area</div>
              <div className="meta">{includeSame}</div>
            </div>
            {value === null && <Icon name="check" className="check" />}
          </button>
        </li>
      )}
      {MEETING_AREAS.map((a) => (
        <li key={a.id}>
          <button type="button" role="radio" aria-checked={value === a.id} className="list-row" onClick={() => onChange(a.id)}>
            <div className="grow">
              <div className="title">{a.name}</div>
              <div className="meta">{a.borough}</div>
            </div>
            {value === a.id && <Icon name="check" className="check" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export type Origin = { startAreaId: string | null; startLatLng: { lat: number; lng: number } | null };

/** Optional starting point. Geolocation is requested only after a tap. */
export function OriginPicker({ meetingAreaName, value, onChange }: { meetingAreaName: string; value: Origin; onChange: (o: Origin) => void }) {
  const [geoState, setGeoState] = useState<"idle" | "asking" | "denied" | "outside" | "unsupported">("idle");
  const useLocation = () => {
    if (!("geolocation" in navigator)) return setGeoState("unsupported");
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (lat < 40.4 || lat > 41 || lng < -74.4 || lng > -73.6) return setGeoState("outside");
        setGeoState("idle");
        onChange({ startAreaId: null, startLatLng: { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 } });
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };
  return (
    <>
      <button type="button" className="menu-card" onClick={useLocation} style={{ marginBottom: 8 }}>
        <span className="menu-icon" style={{ background: "var(--teal)" }}>
          <Icon name="location" size={18} />
        </span>
        <span className="grow" style={{ flex: 1 }}>
          {value.startLatLng ? "Using your approximate location" : geoState === "asking" ? "Finding you…" : "Use my current location"}
        </span>
        {value.startLatLng && <Icon name="check" />}
      </button>
      {geoState === "denied" && <p className="caption">Location is off — pick a neighborhood instead.</p>}
      {geoState === "outside" && <p className="caption">That looks outside NYC — pick a neighborhood instead.</p>}
      {geoState === "unsupported" && <p className="caption">This browser can't share location — pick a neighborhood.</p>}
      <AreaList
        value={value.startLatLng ? "__geo" : value.startAreaId}
        onChange={(id) => onChange({ startAreaId: id, startLatLng: null })}
        includeSame={meetingAreaName}
      />
    </>
  );
}
