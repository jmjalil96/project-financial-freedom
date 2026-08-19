import { describe, expect, it } from "vitest";

import {
  formatMoney,
  minorUnitsToDecimalInput,
  MoneyParseError,
  parseMoneyToMinorUnits,
  sumMinorUnits,
} from "@/domain/money";

describe("money", () => {
  it("parses exact decimal values into integer minor units", () => {
    expect(parseMoneyToMinorUnits("82.45", "USD")).toBe(8245);
    expect(parseMoneyToMinorUnits("-500", "USD")).toBe(-50000);
    expect(parseMoneyToMinorUnits("3000.0", "USD")).toBe(300000);
  });

  it("rejects excess precision instead of rounding", () => {
    expect(() => parseMoneyToMinorUnits("10.001", "USD")).toThrow(MoneyParseError);
  });

  it("distinguishes invalid syntax from excessive precision", () => {
    for (const invalid of ["1,000", "$10", ".50", "(82.45)"]) {
      expect(() => parseMoneyToMinorUnits(invalid, "USD")).toThrow(
        "plain decimal amount",
      );
    }

    expect(() => parseMoneyToMinorUnits("10.001", "USD")).toThrow(
      "no more than 2 decimal places",
    );
  });

  it("enforces positive nonzero transaction amounts", () => {
    const options = {
      allowNegative: false,
      allowZero: false,
    };

    expect(() => parseMoneyToMinorUnits("-1.00", "USD", options)).toThrow(
      "Enter a positive amount.",
    );
    expect(() => parseMoneyToMinorUnits("0", "USD", options)).toThrow(
      "Enter an amount greater than zero.",
    );
  });

  it("formats minor units with the selected currency", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
  });

  it("normalizes signed zero and formats safe integer limits exactly", () => {
    expect(Object.is(parseMoneyToMinorUnits("-0.00", "USD"), -0)).toBe(false);
    expect(formatMoney(-0, "USD")).toBe("$0.00");
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD")).toBe("$90,071,992,547,409.91");
  });

  it("converts minor units to exact decimal input and normalizes signed zero", () => {
    expect(minorUnitsToDecimalInput(Number.MAX_SAFE_INTEGER, "USD")).toBe(
      "90071992547409.91",
    );
    expect(minorUnitsToDecimalInput(-Number.MAX_SAFE_INTEGER, "USD")).toBe(
      "-90071992547409.91",
    );
    expect(minorUnitsToDecimalInput(-0, "USD")).toBe("0.00");
  });

  it("rejects unsafe intermediate and aggregate minor-unit totals", () => {
    expect(() => sumMinorUnits([Number.MAX_SAFE_INTEGER, 1])).toThrow(
      "combined amount is too large",
    );
    expect(() => sumMinorUnits([Number.MAX_SAFE_INTEGER, 1, -1])).toThrow(
      "combined amount is too large",
    );
  });
});
