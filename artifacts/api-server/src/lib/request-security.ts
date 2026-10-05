/** Authentication redirects must remain within the application, including after URL normalization. */
export function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  let decoded = value;
  for (let pass = 0; pass < 4; pass += 1) {
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) return "/";
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return "/";
    }
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) return "/";
  const base = "https://stridepool.invalid";
  try {
    const target = new URL(value, base);
    if (target.origin !== base || target.pathname.startsWith("//")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

/** Exact deployment and workspace origins only; never trust an incoming Origin or Host header. */
export function getTrustedCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = [
    ...(env.REPLIT_DOMAINS ?? "").split(","),
    ...(env.STRIDEPOOL_ALLOWED_ORIGINS ?? "").split(","),
    ...(env.NODE_ENV === "production" ? [] : [env.REPLIT_DEV_DOMAIN, env.REPLIT_EXPO_DEV_DOMAIN]),
  ];
  const origins = new Set<string>();
  for (const entry of configured) {
    if (!entry?.trim()) continue;
    try {
      const url = new URL(entry.includes("://") ? entry.trim() : `https://${entry.trim()}`);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) continue;
      origins.add(url.origin);
    } catch {
      // Invalid configuration never broadens access.
    }
  }
  return origins;
}

export function isTrustedCorsOrigin(origin: string | undefined, trusted: ReadonlySet<string>): boolean {
  return origin === undefined || trusted.has(origin);
}