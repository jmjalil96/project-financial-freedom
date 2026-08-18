import type { BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";

export class MoneyParseError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

type CurrencyMetadata = {
  fractionDigits: number;
  scale: number;
  formatter: Intl.NumberFormat;
};

const currencyMetadata = new Map<BaseCurrency, CurrencyMetadata>();
const plainDecimalPattern = /^-?\d+(?:\.\d+)?$/;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function getCurrencyMetadata(currency: BaseCurrency): CurrencyMetadata {
  const cached = currencyMetadata.get(currency);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const metadata = {
    fractionDigits,
    scale: 10 ** fractionDigits,
    formatter,
  };

  currencyMetadata.set(currency, metadata);
  return metadata;
}

export function getCurrencyFractionDigits(currency: BaseCurrency): number {
  return getCurrencyMetadata(currency).fractionDigits;
}

type ParseMoneyOptions = {
  allowNegative?: boolean;
  allowZero?: boolean;
};

export function parseMoneyToMinorUnits(
  rawValue: string,
  currency: BaseCurrency,
  { allowNegative = true, allowZero = true }: ParseMoneyOptions = {},
): number {
  const value = rawValue.trim();
  const { fractionDigits, scale } = getCurrencyMetadata(currency);

  if (!plainDecimalPattern.test(value)) {
    throw new MoneyParseError(
      "Enter a plain decimal amount without symbols, separators, or parentheses.",
    );
  }

  const negative = value.startsWith("-");
  const unsignedValue = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsignedValue.split(".");

  if (fraction.length > fractionDigits) {
    throw new MoneyParseError(
      `Enter an amount with no more than ${fractionDigits} decimal places.`,
    );
  }

  const minorUnits =
    BigInt(whole!) * BigInt(scale) +
    BigInt(fraction.padEnd(fractionDigits, "0") || "0");

  if (minorUnits > maximumSafeInteger) {
    throw new MoneyParseError("The amount is too large.");
  }

  const normalizedMinorUnits = Number(minorUnits);
  const signedMinorUnits =
    negative && normalizedMinorUnits !== 0
      ? -normalizedMinorUnits
      : normalizedMinorUnits;

  if (!allowNegative && signedMinorUnits < 0) {
    throw new MoneyParseError("Enter a positive amount.");
  }

  if (!allowZero && signedMinorUnits === 0) {
    throw new MoneyParseError("Enter an amount greater than zero.");
  }

  return signedMinorUnits;
}

export function formatMoney(amountMinor: number, currency: BaseCurrency): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new DomainError("The amount cannot be formatted safely.");
  }

  const { fractionDigits, scale, formatter } = getCurrencyMetadata(currency);
  const normalizedAmount = amountMinor === 0 ? 0 : amountMinor;
  const negative = normalizedAmount < 0;
  const absoluteMinor = BigInt(Math.abs(normalizedAmount));
  const whole = absoluteMinor / BigInt(scale);
  const fraction = absoluteMinor % BigInt(scale);
  const decimal =
    fractionDigits === 0
      ? whole.toString()
      : `${whole}.${fraction.toString().padStart(fractionDigits, "0")}`;
  const exactDecimal = negative ? `-${decimal}` : decimal;
  const formatExact = formatter.format as unknown as (value: string) => string;

  return formatExact(exactDecimal);
}

export function sumMinorUnits(
  amounts: Iterable<number>,
  errorMessage = "The combined amount is too large.",
): number {
  let total = 0;

  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount)) {
      throw new DomainError(errorMessage);
    }

    total += amount;

    if (!Number.isSafeInteger(total)) {
      throw new DomainError(errorMessage);
    }
  }

  return total;
}
