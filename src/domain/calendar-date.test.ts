import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  differenceInCalendarDays,
  getCalendarMonthBounds,
  getLocalCalendarDate,
  isCalendarDate,
} from "@/domain/calendar-date";

describe("calendar date utilities", () => {
  it("validates dates and crosses month and leap-year boundaries without timezones", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(addCalendarDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(differenceInCalendarDays("2026-08-31", "2026-09-03")).toBe(3);
    expect(getCalendarMonthBounds("2024-02")).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });

  it("uses local date fields rather than a UTC conversion", () => {
    const instant = new Date(2026, 7, 31, 23, 30);
    expect(getLocalCalendarDate(instant)).toBe("2026-08-31");
  });
});
