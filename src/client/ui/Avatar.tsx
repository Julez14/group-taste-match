import { Icon } from "./Icon";

const COLORS = ["#c7856b", "#6f8f7a", "#8a7bb5", "#b58a5a", "#5f8fa6", "#a8667a", "#7a8a4f", "#4f7a8a"];

function colorFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({
  name,
  seed,
  size = "md",
  done = false,
}: {
  name: string;
  seed?: string;
  size?: "sm" | "md";
  done?: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`avatar${size === "sm" ? " avatar-sm" : ""}`}
      style={{ background: colorFor(seed ?? name) }}
      aria-label={done ? `${name}, ready` : name}
      role="img"
    >
      {initial}
      {done && (
        <span className="avatar-badge">
          <Icon name="check" size={11} stroke={3} />
        </span>
      )}
    </span>
  );
}
