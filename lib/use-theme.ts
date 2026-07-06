"use client";
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>("system");

  useEffect(() => {
    // One-time read of a browser-only value (localStorage) after mount, so the
    // server-rendered/first-paint state ("system") stays consistent with the
    // pre-paint script in app/layout.tsx and hydration doesn't mismatch.
    const stored = localStorage.getItem("theme") as ThemePref | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefState(stored);
    }
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    localStorage.setItem("theme", p);
    apply(p);
  }, []);

  return { pref, setPref };
}
