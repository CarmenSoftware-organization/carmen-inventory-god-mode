"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initialOperationState,
  reduceOperation,
  readNdjson,
  type OperationState,
} from "@/lib/operation-stream";

export function useOperationStream(): {
  state: OperationState;
  start: (url: string, payload: unknown) => Promise<void>;
} {
  const router = useRouter();
  const [state, setState] = useState<OperationState>(initialOperationState);
  const running = useRef(false);

  const start = useCallback(async (url: string, payload: unknown) => {
    if (running.current) return;
    running.current = true;
    setState({ ...initialOperationState, phase: "running" });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      running.current = false;
      setState({ phase: "error", done: 0, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    if (!res.ok || !res.body) {
      let message = `Request failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* non-JSON */ }
      running.current = false;
      setState({ phase: "error", done: 0, error: message });
      return;
    }

    let redirectTo: string | undefined;
    for await (const event of readNdjson(res.body.getReader())) {
      if (event.type === "done") redirectTo = event.redirect;
      setState((prev) => reduceOperation(prev, event));
    }

    running.current = false;
    if (redirectTo) { router.refresh(); router.push(redirectTo); }
  }, [router]);

  return { state, start };
}
