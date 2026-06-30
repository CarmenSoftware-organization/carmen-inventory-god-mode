import { env } from "@/lib/env";
import { LoginTabs } from "@/app/login/login-tabs";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        {/* Hazard tape — first signal of what this console operates on. */}
        <span aria-hidden="true" className="hazard-tape block h-1.5" />
        <div className="space-y-6 p-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-foreground font-display text-sm font-semibold text-background">
                C
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="font-display text-sm font-semibold tracking-tight text-foreground">
                  CARMEN
                </span>
                <span className="font-display text-[10px] font-medium uppercase tracking-[0.18em] text-foreground-subtle">
                  God&nbsp;Mode
                </span>
              </span>
            </div>
            <div className="space-y-1">
              <p className="eyebrow">Restricted console</p>
              <p className="text-sm text-foreground-muted">
                Sign in to operate on live inventory data. Every write is permanent.
              </p>
            </div>
          </div>
          <LoginTabs gatewayEnabled={env().gatewayEnabled} />
        </div>
      </div>
    </main>
  );
}
