export const sqliteQueryChunkSize = 500;

export function queryInChunks<Identifier, Result>(
  identifiers: readonly Identifier[],
  query: (chunk: Identifier[]) => readonly Result[],
  chunkSize = sqliteQueryChunkSize,
): Result[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("The query chunk size must be a positive integer.");
  }

  const results: Result[] = [];
  for (let offset = 0; offset < identifiers.length; offset += chunkSize) {
    results.push(...query(identifiers.slice(offset, offset + chunkSize)));
  }
  return results;
}
