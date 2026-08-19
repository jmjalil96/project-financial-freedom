import { describe, expect, it } from "vitest";

import {
  assertExternalTransferDirection,
  assertTransferMatchWindow,
  inferMatchedTransferClassification,
} from "@/domain/transfers";

describe("transfer rules", () => {
  it("distinguishes owned-account transfers from card and loan payments", () => {
    expect(inferMatchedTransferClassification("checking", "savings")).toBe(
      "owned_account",
    );
    expect(inferMatchedTransferClassification("checking", "credit_card")).toBe(
      "card_payment",
    );
    expect(inferMatchedTransferClassification("loan", "checking")).toBe("card_payment");
  });

  it("enforces external directions and the inclusive match window", () => {
    expect(() => assertExternalTransferDirection("external_out", -1)).not.toThrow();
    expect(() => assertExternalTransferDirection("external_in", 1)).not.toThrow();
    expect(() => assertExternalTransferDirection("external_out", 1)).toThrow(
      "must decrease",
    );
    expect(() => assertExternalTransferDirection("external_in", -1)).toThrow(
      "must increase",
    );
    expect(() => assertTransferMatchWindow("2026-08-10", "2026-08-13")).not.toThrow();
    expect(() => assertTransferMatchWindow("2026-08-10", "2026-08-14")).toThrow(
      "within 3 days",
    );
  });
});
