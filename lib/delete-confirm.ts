export function requiredPhrase(opts: { isBusinessUnit: boolean; dropSchema: string | null }): string {
  return opts.dropSchema ? opts.dropSchema : "DELETE";
}
export function phraseMatches(input: string, required: string): boolean {
  return input === required;
}

export function radiusTouchesBusinessUnits(
  byTable: Array<{ schema: string; table: string }>,
  systemSchema: string,
): boolean {
  return byTable.some((b) => b.schema === systemSchema && b.table === "tb_business_unit");
}
