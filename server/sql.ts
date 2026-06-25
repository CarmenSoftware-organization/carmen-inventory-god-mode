"use server";
import { classifyStatement } from "@/lib/sql-guard";
import { runRead, previewWrite, applyWrite, type SqlResult } from "@/lib/sql-runner";

export async function runSql(schema: string, statement: string): Promise<SqlResult> {
  const s = statement.trim();
  if (!s) throw new Error("Empty statement");
  return classifyStatement(s) === "read" ? runRead(schema, s) : previewWrite(schema, s);
}

export async function applySql(schema: string, statement: string): Promise<SqlResult> {
  const s = statement.trim();
  if (classifyStatement(s) === "read") return runRead(schema, s);
  return applyWrite(schema, s);
}
