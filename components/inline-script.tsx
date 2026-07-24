"use client";

// Must be a Client Component. The `type` expression has to re-evaluate on the
// client (→ "text/plain") to satisfy React 19's isScriptDataBlock check and
// silence its dev warning about rendering <script> tags. Imported into a Server
// Component (e.g. the root layout), the expression would freeze to
// "text/javascript" in the RSC payload and the warning would fire on hydration.
//
// SSR emits `text/javascript` so the browser executes the script synchronously
// during HTML parsing (before first paint); on the client it re-renders as
// `text/plain` so the browser ignores it and React does not warn.
// `suppressHydrationWarning` reconciles the server↔client `type` mismatch.
// See node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
