export function normalizeDescription(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .trim()
    .replace(/[\p{Separator}\s]+/gu, " ");
}
