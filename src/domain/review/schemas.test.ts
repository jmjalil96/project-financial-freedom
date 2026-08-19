import { describe, expect, it } from "vitest";

import {
  confirmedTypeSchema,
  dispositionSchema,
  inboxFilterSchema,
} from "@/domain/review/schemas";

describe("review schemas", () => {
  it("accepts the supported review vocabulary", () => {
    expect(dispositionSchema.parse("duplicate")).toBe("duplicate");
    expect(confirmedTypeSchema.parse("refund")).toBe("refund");
    expect(inboxFilterSchema.parse("ready_to_finalize")).toBe("ready_to_finalize");
  });

  it("rejects unsupported persisted values", () => {
    expect(dispositionSchema.safeParse("pending").success).toBe(false);
    expect(confirmedTypeSchema.safeParse("fee").success).toBe(false);
    expect(inboxFilterSchema.safeParse("all").success).toBe(false);
  });
});
