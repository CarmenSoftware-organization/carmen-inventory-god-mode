import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BusinessUnitsTable } from "@/components/business-units-table";
import { listBusinessUnits, listSelectableSchemas } from "@/lib/registry";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SchemasPage() {
  const [bus, sel] = await Promise.all([listBusinessUnits(), listSelectableSchemas()]);
  return (
    <div>
      <PageHeader
        rubric="Registry"
        title="Schemas"
        lede="Pick a target schema to inspect its tables and rows, or manage business units."
      />

      <div className="space-y-8">
        {/* System link */}
        <section>
          <SectionLabel>System</SectionLabel>
          <Link href={`/${encodeURIComponent(sel.system)}/tables`}>
            <Button variant="outline" size="sm">
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              Manage {sel.system} (registry, users, business units)
            </Button>
          </Link>
        </section>

        {/* Business units */}
        <section>
          <SectionLabel>Business units</SectionLabel>
          <BusinessUnitsTable bus={bus} system={sel.system} />
        </section>

        {/* All schemas */}
        <section>
          <SectionLabel>All schemas</SectionLabel>
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <div className="rule-double flex items-center justify-between px-4 py-2">
              <span className="rubric">Schema</span>
              <span className="rubric">Open</span>
            </div>
            <ul>
              {sel.allSchemas.map((s) => (
                <li key={s} className="border-b border-border last:border-0">
                  <Link
                    href={`/${encodeURIComponent(s)}/tables`}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <span className="truncate font-mono text-[13px] text-foreground">{s}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
