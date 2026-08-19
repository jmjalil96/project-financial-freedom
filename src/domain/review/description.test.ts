import { describe, expect, it } from "vitest";

import { normalizeDescription } from "@/domain/review/description";

describe("normalizeDescription", () => {
  it("normalizes Unicode forms, case, and Unicode spacing", () => {
    expect(normalizeDescription("  ＣＡＦＥ\u0301　食品  ")).toBe("café 食品");
    expect(normalizeDescription("CAFÉ\t食品")).toBe("café 食品");
  });

  it("conservatively retains punctuation, accents, letters, and digits", () => {
    expect(normalizeDescription("Market #12")).toBe("market #12");
    expect(normalizeDescription("Market 12")).toBe("market 12");
    expect(normalizeDescription("Cafe")).not.toBe(normalizeDescription("Café"));
    expect(normalizeDescription("ПРОДУКТЫ ٣")).toBe("продукты ٣");
  });
});
