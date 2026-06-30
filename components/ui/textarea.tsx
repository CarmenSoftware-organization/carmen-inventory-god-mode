import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Token-driven textarea. Used for JSON / SQL / long text. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground",
        "placeholder:text-foreground-subtle",
        "transition-colors hover:border-border-strong",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:border-transparent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
