import { describe, expect, it } from "vitest";

import { queryInChunks } from "@/db/query-chunks";

describe("queryInChunks", () => {
  it("bounds each query and preserves result order", () => {
    const chunkLengths: number[] = [];
    const result = queryInChunks(
      [1, 2, 3, 4, 5],
      (chunk) => {
        chunkLengths.push(chunk.length);
        return chunk.map((value) => value * 2);
      },
      2,
    );

    expect(chunkLengths).toEqual([2, 2, 1]);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it("does not execute a query for an empty identifier set", () => {
    let called = false;
    expect(
      queryInChunks([], () => {
        called = true;
        return [];
      }),
    ).toEqual([]);
    expect(called).toBe(false);
  });
});
