import { useEffect, useState } from "react";

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}
