export function requiredPhrase(opts: { isBusinessUnit: boolean; dropSchema: string | null }): string {
  return opts.dropSchema ? opts.dropSchema : "DELETE";
}
export function phraseMatches(input: string, required: string): boolean {
  return input === required;
}
