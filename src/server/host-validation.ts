const allowedLoopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

export function isAllowedLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader || /[\s/@]/.test(hostHeader)) {
    return false;
  }

  try {
    const hostname = new URL(`http://${hostHeader}`).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();

    return allowedLoopbackHosts.has(hostname);
  } catch {
    return false;
  }
}
