import { z } from "zod";

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function createUtcCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function isCalendarDate(value: string): boolean {
  if (!calendarDatePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = createUtcCalendarDate(year!, month!, day!);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Enter a valid calendar date.");

export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(createUtcCalendarDate(year!, month!, day!));
}

export function formatCalendarMonth(value: string): string {
  if (!isCalendarMonth(value)) {
    throw new Error("Calendar months must use YYYY-MM.");
  }
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(createUtcCalendarDate(year!, month!, 1));
}

export function addCalendarDays(value: string, days: number): string {
  const date = calendarDateSchema.parse(value);
  if (!Number.isInteger(days)) {
    throw new Error("Calendar day offsets must be whole numbers.");
  }
  const [year, month, day] = date.split("-").map(Number);
  return createUtcCalendarDate(year!, month!, day! + days)
    .toISOString()
    .slice(0, 10);
}

export function differenceInCalendarDays(from: string, to: string): number {
  const start = calendarDateSchema.parse(from);
  const end = calendarDateSchema.parse(to);
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (createUtcCalendarDate(endYear!, endMonth!, endDay!).getTime() -
      createUtcCalendarDate(startYear!, startMonth!, startDay!).getTime()) /
      86_400_000,
  );
}

export function getLocalCalendarDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLocalCalendarMonth(now = new Date()): string {
  return getLocalCalendarDate(now).slice(0, 7);
}

export function getCalendarMonthBounds(month: string): {
  start: string;
  end: string;
} {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Calendar months must use YYYY-MM.");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber! < 1 || monthNumber! > 12) {
    throw new Error("Calendar months must use YYYY-MM.");
  }
  const start = `${year!.toString().padStart(4, "0")}-${monthNumber!
    .toString()
    .padStart(2, "0")}-01`;
  const end = createUtcCalendarDate(year!, monthNumber! + 1, 0)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

export function isCalendarMonth(value: string): boolean {
  try {
    getCalendarMonthBounds(value);
    return true;
  } catch {
    return false;
  }
}
