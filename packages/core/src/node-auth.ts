/**
 * The `Authorization` header value for a lattice-node operator (loopback)
 * port. The node writes a fresh cookie file at every start (bitcoind-style,
 * content `__cookie__:<token>`); pass either that file's content, sent as HTTP
 * Basic, or the bare token, sent as Bearer. Surrounding whitespace is ignored.
 */
export function nodeCookieAuthorization(cookie: string): string {
  const value = cookie.trim();
  if (value.length === 0 || /[\s]/.test(value)) {
    throw new Error("node cookie must be a non-empty token without whitespace");
  }
  if (!value.includes(":")) return `Bearer ${value}`;
  return `Basic ${btoa(value)}`;
}
