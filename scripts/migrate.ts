import { ensureAuditTable } from "@/lib/audit";
ensureAuditTable().then(() => { console.log("audit table ready"); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
