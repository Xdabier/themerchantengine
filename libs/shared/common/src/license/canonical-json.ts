/**
 * Canonical JSON for license signing: object keys sorted recursively, no
 * whitespace, arrays in order. The signature covers exactly this string, so
 * the signer (private repository) and the verifier (`LicenseService`) must
 * agree byte for byte. Kept dependency-free so both can import it.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
