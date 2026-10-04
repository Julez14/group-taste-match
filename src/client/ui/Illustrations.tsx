/* Teal line-art in the style of Beli's empty states and confirmations. */

const stroke = { stroke: "var(--teal)", strokeWidth: 3, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PlateIllustration() {
  return (
    <div className="illustration">
      <svg width="150" height="130" viewBox="0 0 150 130">
        <ellipse cx="75" cy="72" rx="42" ry="42" {...stroke} fill="#fff" />
        <ellipse cx="75" cy="72" rx="28" ry="28" {...stroke} />
        <path d="M18 30v28c0 6 4 9 8 9v50M26 30v26M34 30v28c0 6-4 9-8 9" {...stroke} />
        <path d="M124 30c-8 6-10 18-10 30h10v57" {...stroke} />
      </svg>
    </div>
  );
}

export function MapPinIllustration() {
  return (
    <div className="illustration">
      <svg width="170" height="140" viewBox="0 0 170 140">
        <path d="M20 60l38-14 40 14 50-16v70l-50 16-40-14-38 14z" {...stroke} fill="#fff" />
        <path d="M58 46v70M98 60v70" {...stroke} />
        <path d="M30 98c12-6 18 2 28-4M104 92c10 6 20-4 32 2" {...stroke} strokeWidth={2.2} />
        <path d="M85 14c-14 0-24 10-24 23 0 18 24 38 24 38s24-20 24-38c0-13-10-23-24-23z" {...stroke} fill="var(--teal)" />
        <circle cx="85" cy="37" r="8" fill="#fff" />
      </svg>
    </div>
  );
}

export function ThinkingIllustration() {
  return (
    <div className="illustration">
      <svg width="160" height="140" viewBox="0 0 160 140" className="thinking">
        <rect x="34" y="30" width="92" height="84" rx="10" {...stroke} fill="#fff" />
        <path d="M52 58h56M52 76h40M52 94h48" {...stroke} />
        <circle cx="118" cy="40" r="16" {...stroke} fill="#fff" />
        <path d="M130 52l14 14" {...stroke} strokeWidth={4} />
        <path d="M18 24l4 8M14 40h8M142 102l6 6M146 92h8" {...stroke} strokeWidth={2.2} />
      </svg>
    </div>
  );
}

export function PaperPlaneIllustration() {
  return (
    <div className="illustration">
      <svg width="170" height="130" viewBox="0 0 170 130">
        <path d="M30 70l110-46-36 86-22-30z" {...stroke} fill="#fff" />
        <path d="M82 80l58-56M82 80l-6 30 18-18" {...stroke} />
        <path d="M24 100c18-4 30-18 46-16" {...stroke} strokeDasharray="4 7" strokeWidth={2.2} />
      </svg>
    </div>
  );
}

export function EmptyTableIllustration() {
  return (
    <div className="illustration">
      <svg width="170" height="130" viewBox="0 0 170 130">
        <path d="M24 56h122M36 56l-8 54M134 56l8 54M60 56v40M110 56v40" {...stroke} />
        <path d="M60 40c0-8 6-14 14-14h22c8 0 14 6 14 14v16H60z" {...stroke} fill="#fff" />
        <path d="M72 18l26 20M98 18L72 38" {...stroke} strokeWidth={2.6} />
      </svg>
    </div>
  );
}
