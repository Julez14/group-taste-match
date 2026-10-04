import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export function TopBar({
  onBack,
  title,
  right,
  brand = false,
}: {
  onBack?: () => void;
  title?: string;
  right?: ReactNode;
  brand?: boolean;
}) {
  return (
    <header className="topbar">
      <div style={{ width: 80 }}>
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="back" />
          </button>
        ) : brand ? (
          <span className="wordmark" style={{ paddingLeft: 6 }}>
            beli
          </span>
        ) : null}
      </div>
      {title ? <div className="topbar-title">{title}</div> : <div />}
      <div style={{ width: 80, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </header>
  );
}

type ToastKind = "dark" | "success";
const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((message: string, kind: ToastKind = "dark") => {
    clearTimeout(timer.current);
    setToast({ message, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast${toast.kind === "success" ? " toast-success" : ""}`} role="status">
          {toast.message}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" />
        {children}
      </div>
    </div>
  );
}

/** Countdown against the server clock; `offset` = serverNow - Date.now() at receipt. */
export function Countdown({ deadline, offset }: { deadline: number; offset: number }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(id);
  }, [offset]);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <span className={`countdown${left <= 10 ? " urgent" : ""}`} aria-live={left <= 10 ? "polite" : "off"}>
      <Icon name="clock" size={16} />
      {left === 0 ? "Time's up" : `${m}:${s} left`}
    </span>
  );
}
