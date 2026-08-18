import { describe, expect, it } from "vitest";

import { isAllowedLoopbackHost } from "@/server/host-validation";

describe("isAllowedLoopbackHost", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "[::1]",
    "[::1]:3000",
  ])("accepts loopback host %s", (host) => {
    expect(isAllowedLoopbackHost(host)).toBe(true);
  });

  it.each([
    null,
    "",
    "example.com",
    "localhost.example.com",
    "127.0.0.1.example.com",
    "example.com@127.0.0.1",
    "127.0.0.1/path",
  ])("rejects non-loopback host %s", (host) => {
    expect(isAllowedLoopbackHost(host)).toBe(false);
  });
});
