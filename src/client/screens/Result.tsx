import { formatDiningTime } from "../../shared/time";
import type { NoMatch, ResultCard } from "../../shared/types";
import { navigate } from "../router";
import { TopBar } from "../ui/Chrome";
import { Icon, type IconName } from "../ui/Icon";
import { EmptyTableIllustration } from "../ui/Illustrations";

const LINK_ICON: Record<ResultCard["links"][number]["kind"], IconName> = {
  website: "globe",
  menu: "menu",
  directions: "directions",
  booking: "calendar",
};

const money = (n: number) => `$${Math.round(n)}`;

export function Result({ card, fixtureMode }: { card: ResultCard; fixtureMode: boolean }) {
  const slot = card.availability;
  return (
    <>
      <TopBar brand />
      <div className="result-hero">
        <div className="result-hero-pin">
          <Icon name="pin" size={26} />
        </div>
        <div className="caption" style={{ color: "var(--teal)", fontWeight: 700, letterSpacing: 0.4 }}>
          YOUR GROUP'S PICK
        </div>
        <h1 className="display-xl">{card.name}</h1>
      </div>
      <div className="screen" style={{ paddingTop: 12 }}>
        <div className="tagline">{card.cuisines.map(cap).join(" · ")}</div>
        <div style={{ marginTop: 4 }}>
          {money(card.mealEstimate.low)}–{money(card.mealEstimate.high)} per person
        </div>
        <div className="caption" style={{ fontSize: 14 }}>
          {card.neighborhood} · {card.address}
        </div>

        <div className="chips" style={{ marginTop: 14 }}>
          {card.links.map((l) => (
            <a key={l.url + l.kind} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">
              <Icon name={LINK_ICON[l.kind]} size={16} /> {l.label}
            </a>
          ))}
        </div>

        <div className="section-title">Why this spot</div>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{card.explanation}</p>

        <div className="section-title">Reserve a table</div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="row caption" style={{ fontSize: 14, color: "var(--ink-2)" }}>
            <Icon name="people" size={18} /> {card.partySize} · {formatDiningTime(card.diningAt)}
          </span>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 10, alignItems: "center" }}>
          {slot.slot ? (
            <span className="slot">
              {slot.slot}
              <small>{slot.status === "reservable" ? "TABLE" : "WALK-IN"}</small>
            </span>
          ) : (
            <span className="slot slot-muted" style={{ padding: "0 12px" }}>
              {slot.status === "walk_in" ? "Walk-in" : "Check availability"}
            </span>
          )}
          <span className="caption" style={{ flex: 1 }}>
            {slot.label}
          </span>
        </div>
        <p className="caption" style={{ marginTop: 8 }}>
          Simulated availability — prototype. A booking link doesn't confirm a reservation.
        </p>

        <div className="section-title">Good to know</div>
        <ul className="list">
          <li className="list-row" style={{ cursor: "default", alignItems: "flex-start" }}>
            <Icon name="receipt" />
            <div className="grow">
              <div className="title">
                About {money(card.mealEstimate.low)}–{money(card.mealEstimate.high)} per person
              </div>
              <div className="meta">{card.mealEstimate.basis}</div>
            </div>
          </li>
          <li className="list-row" style={{ cursor: "default", alignItems: "flex-start" }}>
            <Icon name="directions" />
            <div className="grow">
              <div className="title">Getting there</div>
              <div className="meta">{card.travel.summary}</div>
            </div>
          </li>
          {card.assumptions.map((a) => (
            <li key={a} className="list-row" style={{ cursor: "default", alignItems: "flex-start" }}>
              <Icon name="info" />
              <div className="grow meta" style={{ color: "var(--ink-2)", fontSize: 14 }}>
                {a}
              </div>
            </li>
          ))}
        </ul>
        {fixtureMode && (
          <p className="caption" style={{ marginTop: 16 }}>
            Fixture mode: this pick came from canned development logic, not a live model.
          </p>
        )}
      </div>
    </>
  );
}

export function NoMatchScreen({ noMatch }: { noMatch: NoMatch }) {
  return (
    <>
      <TopBar brand />
      <div className="screen screen-center">
        <EmptyTableIllustration />
        <h1 className="display">No spot fits everyone</h1>
        <p className="subtle">{noMatch.message}</p>
        <p className="caption">We only searched this prototype's list of NYC restaurants — not every restaurant in the city.</p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => navigate("/")}>
          Start a new group
        </button>
      </div>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
