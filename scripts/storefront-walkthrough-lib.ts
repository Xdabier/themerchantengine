/**
 * The pure parts of `scripts/storefront-walkthrough.ts`: the cookie jar, the
 * transcript formatting, the argument parser and the idempotency-retry
 * comparison. Nothing here touches the network, so
 * `scripts/__tests__/storefront-walkthrough.spec.ts` covers all of it.
 */

/** A list longer than this is printed as its first items plus a `... n more` line. */
export const MAX_LIST_ITEMS = 2;

/** The response headers the transcript shows, in this order. */
export const SHOWN_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'x-request-id',
  'set-cookie',
];

export interface WalkthroughOptions {
  base: string;
  /** Empty when the caller left it to the store config. */
  locales: string[];
  /**
   * The storefront origin the engine's CORS allowlist names. Better Auth
   * refuses a cookie-bearing mutation without an `Origin` header, and the
   * engine's CORS layer refuses one it does not allow, so the walkthrough
   * states the origin a browser storefront would.
   */
  origin: string;
}

export const DEFAULT_BASE = 'http://localhost:53000/api';
export const DEFAULT_ORIGIN = 'http://localhost:53300';

export function parseArgs(argv: string[]): WalkthroughOptions {
  const options: WalkthroughOptions = { base: DEFAULT_BASE, locales: [], origin: DEFAULT_ORIGIN };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base' && argv[i + 1]) options.base = argv[++i].replace(/\/+$/, '');
    else if (arg === '--origin' && argv[i + 1]) options.origin = argv[++i].replace(/\/+$/, '');
    else if (arg === '--locales' && argv[i + 1]) {
      options.locales = argv[++i]
        .split(',')
        .map((locale) => locale.trim())
        .filter(Boolean);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

/**
 * A hand-rolled cookie jar: every `Set-Cookie` is stored by name and replayed
 * as one `Cookie` header. A cookie cleared by the server (empty value,
 * `Max-Age=0` or an `Expires` in the past) is dropped, which is how the cart
 * merge retires the anonymous `sessionId`.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(setCookie: string[]): void {
    for (const line of setCookie) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const cleared = attributes.some((attribute) => {
        const [key, raw] = attribute.split('=', 2);
        const attr = key.toLowerCase();
        if (attr === 'max-age') return Number(raw) <= 0;
        if (attr === 'expires') return new Date(raw).getTime() <= Date.now();
        return false;
      });
      if (cleared || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /** The `Cookie` header to send, or undefined when the jar is empty. */
  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

/** `name=<redacted>; Path=/; HttpOnly`: the value goes, the attributes stay. */
export function redactSetCookie(line: string): string {
  return line.replace(/^([^=;]+)=[^;]*/, '$1=<redacted>');
}

/** Every `name=value` pair of a `Cookie` header, values redacted. */
export function redactCookieHeader(header: string): string {
  return header
    .split(';')
    .map((pair) => redactSetCookie(pair.trim()))
    .join('; ');
}

/**
 * JSON, two-space indented, with any list longer than `MAX_LIST_ITEMS` cut to
 * its first items and a `... n more` line after them.
 */
export function formatJson(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const shown = value
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => `${inner}${formatJson(item, depth + 1)}`)
      .join(',\n');
    const hidden = value.length - MAX_LIST_ITEMS;
    const more = hidden > 0 ? `\n${inner}... ${hidden} more` : '';
    return `[\n${shown}${more}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines = entries
      .map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatJson(item, depth + 1)}`)
      .join(',\n');
    return `{\n${lines}\n${pad}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface StepRecord {
  method: string;
  /** The path after the base, `/v1/store/config`. */
  path: string;
  locale: string;
  /** The request headers that matter, as sent. */
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status: number;
  /** Lower-cased names; `set-cookie` may carry several lines. */
  responseHeaders: Record<string, string[]>;
  /** The parsed JSON body, or the raw text when the body is not JSON. */
  body: unknown;
  /** A remark the flow adds, printed before the response. */
  note?: string;
}

/** One transcript block for one request. */
export function formatStep(step: StepRecord): string {
  const lines = [`### ${step.method} ${step.path}  [Accept-Language: ${step.locale}]`];
  for (const [name, value] of Object.entries(step.requestHeaders)) {
    lines.push(`> ${name}: ${name.toLowerCase() === 'cookie' ? redactCookieHeader(value) : value}`);
  }
  if (step.requestBody !== undefined) lines.push(formatJson(step.requestBody));
  if (step.note) lines.push('', `note: ${step.note}`);
  lines.push('', `HTTP ${step.status}`);
  for (const name of SHOWN_RESPONSE_HEADERS) {
    for (const value of step.responseHeaders[name] ?? []) {
      lines.push(`${name}: ${name === 'set-cookie' ? redactSetCookie(value) : value}`);
    }
  }
  lines.push(typeof step.body === 'string' ? step.body : formatJson(step.body));
  return lines.join('\n') + '\n';
}

/** The order id of a `POST /v1/orders` answer, or undefined when the answer has none. */
export function orderIdOf(body: unknown): string | undefined {
  const data = (body as { data?: { id?: unknown } } | null)?.data;
  return typeof data?.id === 'string' ? data.id : undefined;
}

/** The line the retry prints, and whether the retry returned the order the first call created. */
export function compareRetry(first: unknown, second: unknown): { same: boolean; line: string } {
  const a = orderIdOf(first);
  const b = orderIdOf(second);
  const same = a !== undefined && a === b;
  return {
    same,
    line: same
      ? 'retry: same order'
      : `retry: DIFFERENT ORDER (${a ?? 'none'} then ${b ?? 'none'})`,
  };
}

export const summaryLine = (requests: number, failures: number): string =>
  `walkthrough: ${requests} requests, ${failures} failures`;
