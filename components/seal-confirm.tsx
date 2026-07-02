"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

/**
 * The seal — a two-step irreversible-action ceremony that replaces a plain
 * destructive submit button. Step one: type the exact confirm phrase to ARM
 * the seal. Step two: press-and-hold the seal (~holdMs) to STAMP, which fires
 * `onStamp`. Releasing early cancels. Keyboard: focus + hold Space/Enter.
 * Meaning-by-fill + a real hold make the friction proportional to consequence.
 */
export function SealConfirm({
  requiredPhrase,
  onStamp,
  disabled = false,
  pending = false,
  holdMs = 700,
  label = "Seal & execute",
}: {
  requiredPhrase: string;
  onStamp: () => void;
  disabled?: boolean;
  pending?: boolean;
  holdMs?: number;
  label?: string;
}) {
  const [confirm, setConfirm] = useState("");
  const [holding, setHolding] = useState(false);
  const [sealed, setSealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armed = confirm === requiredPhrase;
  const canSeal = armed && !disabled && !pending && !sealed;

  function begin() {
    if (!canSeal || holding) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      setSealed(true);
      onStamp();
    }, holdMs);
  }
  function cancel() {
    setHolding(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const face = sealed
    ? "Sealed"
    : pending
      ? "Sealing…"
      : armed
        ? "Press & hold to seal"
        : "Type the phrase to arm";

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="seal-confirm-input" className="block text-sm font-medium">
          Type{" "}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
            {requiredPhrase}
          </code>{" "}
          to arm the seal:
        </label>
        <Input
          id="seal-confirm-input"
          name="confirm"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <button
        type="button"
        aria-label={label}
        aria-disabled={!canSeal}
        aria-busy={pending || holding || undefined}
        data-armed={armed}
        data-holding={holding}
        data-sealed={sealed}
        onMouseDown={begin}
        onMouseUp={cancel}
        onMouseLeave={cancel}
        onTouchStart={begin}
        onTouchEnd={cancel}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            begin();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") cancel();
        }}
        className={cn(
          "relative flex h-11 w-full select-none items-center justify-center overflow-hidden rounded-md border transition-colors",
          canSeal ? "border-seal" : "cursor-not-allowed border-border",
        )}
      >
        {/* Ink fill grows left→right over holdMs while holding, then stays. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 origin-left bg-seal",
            holding || sealed ? "scale-x-100" : "scale-x-0",
          )}
          style={{
            transition: holding
              ? `transform ${holdMs}ms linear`
              : "transform 140ms ease-out",
          }}
        />
        <span
          className={cn(
            "relative font-display text-sm font-medium uppercase tracking-[0.12em]",
            holding || sealed
              ? "text-danger-foreground"
              : canSeal
                ? "text-seal"
                : "text-foreground-subtle",
          )}
        >
          {face}
        </span>
      </button>
    </div>
  );
}
