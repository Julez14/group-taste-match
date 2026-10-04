const PATHS = {
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chevron: "M9 6l6 6-6 6",
  share: "M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7.5h14V12",
  mic: "M12 15a3.5 3.5 0 003.5-3.5v-5a3.5 3.5 0 00-7 0v5A3.5 3.5 0 0012 15zM6 11.5a6 6 0 0012 0M12 17.5V21",
  stop: "M7 7h10v10H7z",
  send: "M4 12l16-8-6 16-2.5-6.5L4 12z",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  directions: "M12 2.5l9.5 9.5-9.5 9.5L2.5 12 12 2.5zM9 14v-2.5a1 1 0 011-1h4.5M13 8.5l2 2-2 2",
  calendar: "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4",
  people: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 010 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2",
  pin: "M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0113 0c0 4.9-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  message: "M4 5h16v11H9l-5 4V5z",
  menu: "M6 4.5h12v15H6zM9 9h6M9 12.5h6M9 16h3.5",
  receipt: "M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3v-17zM9 8h6M9 11.5h6M9 15h4",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5.5M12 7.6v.4",
  location: "M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  keyboard: "M3 6.5h18v11H3zM6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7.5 14h9",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4.5V11h-6.5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, stroke = 1.8, className }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} fill={name === "stop" ? "currentColor" : "none"} />
    </svg>
  );
}
