export function ident(name: string): string {
  if (typeof name !== "string" || name.length === 0) throw new Error("Invalid identifier: empty");
  if (Buffer.byteLength(name, "utf8") > 63) throw new Error(`Invalid identifier: too long (${name})`);
  if (name.includes("\0")) throw new Error("Invalid identifier: NUL byte");
  return '"' + name.replace(/"/g, '""') + '"';
}

export function qualified(schema: string, table: string): string {
  return `${ident(schema)}.${ident(table)}`;
}

function stripLeading(sqlText: string): string {
  let s = sqlText.trim();
  // strip leading line and block comments repeatedly
  while (true) {
    if (s.startsWith("--")) { const nl = s.indexOf("\n"); s = nl === -1 ? "" : s.slice(nl + 1).trimStart(); continue; }
    if (s.startsWith("/*")) { const end = s.indexOf("*/"); s = end === -1 ? "" : s.slice(end + 2).trimStart(); continue; }
    break;
  }
  return s;
}

export function classifyStatement(sqlText: string): "read" | "write" {
  const s = stripLeading(sqlText).toUpperCase();
  if (/^EXPLAIN\s+ANALYZE/.test(s)) return "write";
  if (/^(SELECT|EXPLAIN|SHOW|TABLE|VALUES)\b/.test(s)) return "read";
  if (/^WITH\b/.test(s)) {
    // A CTE chain is a write iff it contains a data-modifying statement.
    return /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(s) ? "write" : "read";
  }
  return "write";
}
