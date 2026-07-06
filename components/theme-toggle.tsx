"use client";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemePref } from "@/lib/use-theme";

const NEXT: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };
const ICON = { light: Sun, dark: Moon, system: Monitor };
const LABEL = { light: "Light", dark: "Dark", system: "System" };

/** Cycles light → dark → system. Icon + label reflect the current choice. */
export function ThemeToggle({ showLabel = true }: { showLabel?: boolean }) {
  const { pref, setPref } = useTheme();
  const Icon = ICON[pref];
  return (
    <button
      type="button"
      onClick={() => setPref(NEXT[pref])}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}.`}
      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {showLabel && <span>{LABEL[pref]}</span>}
    </button>
  );
}
