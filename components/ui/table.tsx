import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/*  Table primitives — token-driven, consistent, a11y-aware.          */
/*  Usage: <Table><THead>...</THead><TBody>...</TBody></Table>        */
/* ------------------------------------------------------------------ */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn(
          "w-full caption-bottom text-sm",
          "divide-y divide-border",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("text-left", className)} {...props} />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        "[&_tr]:transition-colors [&_tr]:hover:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border", className)} {...props} />;
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-xs font-medium uppercase tracking-wider text-foreground-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-baseline",
        "max-w-xs truncate",
        className,
      )}
      {...props}
    />
  );
}
