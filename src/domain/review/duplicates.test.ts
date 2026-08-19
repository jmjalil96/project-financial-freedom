import { describe, expect, it } from "vitest";

import {
  classifyDuplicateMatch,
  compareDuplicateCandidates,
  isSelectableDuplicateCandidate,
  type DuplicateMatchInput,
} from "@/domain/review/duplicates";

const base: DuplicateMatchInput = {
  accountId: 7,
  amountMinor: -8245,
  transactionDate: "2026-08-05",
  description: "WHOLE FOODS 102",
  externalId: null,
};

describe("classifyDuplicateMatch", () => {
  it("classifies a matching stable institution ID as strong", () => {
    const candidate = {
      ...base,
      amountMinor: -8254,
      externalId: " TX-100 ",
    };

    expect(
      classifyDuplicateMatch({ ...base, externalId: "TX-100" }, candidate),
    ).toEqual({
      kind: "strong",
      reason: "stable_external_id",
    });
  });

  it("classifies normalized account, amount, date, and description as weak", () => {
    const candidate = {
      ...base,
      description: "  ＷＨＯＬＥ　ＦＯＯＤＳ 102 ",
    };

    expect(classifyDuplicateMatch(base, candidate)).toEqual({
      kind: "weak",
      reason: "account_amount_date_description",
    });
    expect(classifyDuplicateMatch(candidate, base)).toEqual({
      kind: "weak",
      reason: "account_amount_date_description",
    });
  });

  it("does not match across accounts or erase meaningful punctuation", () => {
    expect(classifyDuplicateMatch(base, { ...base, accountId: 8 })).toEqual({
      kind: "none",
      reason: null,
    });
    expect(
      classifyDuplicateMatch(base, {
        ...base,
        description: "WHOLE FOODS #102",
      }),
    ).toEqual({ kind: "none", reason: null });
  });

  it("orders strong candidates before weak candidates explicitly", () => {
    const candidates = [
      {
        id: 1,
        strength: "weak" as const,
        matchKind: "signature" as const,
        createdAt: "2026-08-19 12:00:00",
      },
      {
        id: 2,
        strength: "strong" as const,
        matchKind: "external_id" as const,
        createdAt: "2026-08-19 12:01:00",
      },
    ];

    expect(
      candidates.sort(compareDuplicateCandidates).map((candidate) => candidate.id),
    ).toEqual([2, 1]);
  });

  it("offers only open or confirmed candidates for canonical selection", () => {
    expect(isSelectableDuplicateCandidate("open")).toBe(true);
    expect(isSelectableDuplicateCandidate("confirmed")).toBe(true);
    expect(isSelectableDuplicateCandidate("dismissed")).toBe(false);
  });
});
