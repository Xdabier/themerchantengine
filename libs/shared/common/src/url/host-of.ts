/** `https://admin.shop.example:8443/` gives `admin.shop.example`. */
export function hostOf(origin: string): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
