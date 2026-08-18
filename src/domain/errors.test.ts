import { describe, expect, it, vi } from "vitest";

import { DomainError, getPublicErrorMessage } from "@/domain/errors";

describe("getPublicErrorMessage", () => {
  it("returns intentional domain guidance", () => {
    expect(
      getPublicErrorMessage(new DomainError("Choose an active account."), "Failed."),
    ).toBe("Choose an active account.");
  });

  it("logs unexpected details and returns only the safe fallback", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      getPublicErrorMessage(
        new Error("UNIQUE constraint failed: private_table.secret_column"),
        "The request could not be completed.",
      ),
    ).toBe("The request could not be completed.");
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });
});
