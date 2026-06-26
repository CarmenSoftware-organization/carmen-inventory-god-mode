import { ensureAuditTable } from "@/lib/audit";
import { ensureClusterDeletedAt } from "@/lib/migrations";

Promise.resolve()
  .then(() => ensureAuditTable())
  .then(() => ensureClusterDeletedAt())
  .then(() => { console.log("migrations ready"); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
