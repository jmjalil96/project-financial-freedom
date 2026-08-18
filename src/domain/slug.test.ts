import { describe, expect, it } from "vitest";

import { createSlug } from "@/domain/slug";

describe("createSlug", () => {
  it("normalizes Latin diacritics for stable matching", () => {
    expect(createSlug("Café")).toBe("cafe");
    expect(createSlug("Cafe")).toBe("cafe");
  });

  it("retains non-Latin letters and keeps names distinct from their digits", () => {
    expect(createSlug("食品")).toBe("食品");
    expect(createSlug("项目 123")).toBe("项目-123");
    expect(createSlug("123")).toBe("123");
  });
});
