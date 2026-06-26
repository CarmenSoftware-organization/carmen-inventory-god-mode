import { runMigrations } from "@/lib/migrations";

runMigrations()
  .then(({ count }) => { console.log(`migrations ready (${count} applied)`); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
