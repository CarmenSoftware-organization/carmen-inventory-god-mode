import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { BusinessUnitsTable } from "@/components/business-units-table";
import { listBusinessUnits, listSelectableSchemas } from "@/lib/registry";
import { Button } from "@/components/ui/button";
import { Table, TBody, TR, Td } from "@/components/ui/table";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SchemasPage() {
  const [bus, sel] = await Promise.all([listBusinessUnits(), listSelectableSchemas()]);
  return (
    <div>
      <PageHeader
        eyebrow="Registry"
        title="Schemas"
        lede="Pick a target schema to inspect its tables and rows, or manage business units."
      />

      <div className="space-y-8">
        {/* System link */}
        <section>
          <SectionLabel>System</SectionLabel>
          <Link href={`/${encodeURIComponent(sel.system)}/tables`}>
            <Button variant="outline" size="sm">
              <CaretRight className="h-3.5 w-3.5" aria-hidden="true" />
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
          <Table>
            <TBody>
              {sel.allSchemas.map((s) => (
                <TR key={s}>
                  <Td>
                    <Link
                      href={`/${encodeURIComponent(s)}/tables`}
                      className="inline-flex items-center gap-1 font-mono text-xs text-link hover:text-link-hover"
                    >
                      {s}
                      <CaretRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  </Td>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      </div>
    </div>
  );
}
