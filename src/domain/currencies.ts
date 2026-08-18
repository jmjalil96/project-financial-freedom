import { z } from "zod";

export const supportedCurrencies = [
  { code: "USD", name: "US dollar", symbol: "$" },
  { code: "COP", name: "Colombian peso", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British pound", symbol: "£" },
  { code: "CAD", name: "Canadian dollar", symbol: "$" },
  { code: "MXN", name: "Mexican peso", symbol: "$" },
  { code: "BRL", name: "Brazilian real", symbol: "R$" },
] as const;

const currencyCodes = supportedCurrencies.map((currency) => currency.code) as [
  (typeof supportedCurrencies)[number]["code"],
  ...(typeof supportedCurrencies)[number]["code"][],
];

export const baseCurrencySchema = z.enum(currencyCodes);

export type BaseCurrency = z.infer<typeof baseCurrencySchema>;

export function getCurrencyName(code: BaseCurrency): string {
  return supportedCurrencies.find((currency) => currency.code === code)?.name ?? code;
}
