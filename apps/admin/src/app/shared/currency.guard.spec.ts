import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Recurrence guard for the currency fix
 * (specs/features/admin-qa-remediation/plan-a-currency.md).
 *
 * The root cause was structural, not a set of typos: nine independent money
 * formatters each carried their own hardcoded currency default, so every fix
 * was one copy-paste away from coming back. This scans the feature tree for
 * the two signatures that let it return:
 *
 *  - a hardcoded ISO currency literal anywhere in feature code, and
 *  - a second `Intl.NumberFormat(..., { style: 'currency' })` implementation
 *    outside the one shared formatter.
 *
 * Spec files are excluded: record-currency test fixtures are legitimate.
 */

const FEATURES_DIR = join(__dirname, '..', 'features');
const SHARED_FORMATTER = join(__dirname, 'format', 'money.ts');

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const featureFiles = collect(FEATURES_DIR);

/**
 * Any three-letter uppercase ISO code in quotes. Deliberately broad: the point
 * is that feature code never names a currency, it asks CurrencyStore.
 *
 * This used to be a closed enumeration of fourteen codes, which the doc comment
 * above already described as broad while it was not. XTS was missing from it,
 * so the guard would have passed a feature file hardcoding the new store
 * currency — the exact recurrence it exists to prevent, on the exact phase that
 * introduced the code. It is now a shape plus a small allow-list of
 * three-letter uppercase tokens that are not currencies, so the next client
 * rebrand does not have to remember to extend it.
 */
/**
 * The active ISO 4217 alphabetic codes.
 *
 * A shape-only rule (any three uppercase letters in quotes) cannot tell `'XTS'`
 * from `'DHL'`, `'SKU'` or `'SMS'`, all of which are legitimate enum values in
 * this tree. Matching against the real currency set is the only discriminator
 * that is both precise and stale-proof: any currency a future client runs on is
 * already in this list, so the guard never has to be remembered again.
 *
 * The set is the whole standard, deliberately. A client-reference sweep once
 * replaced two of these codes with values that are not currencies, which left
 * the guard passing a feature file that hardcoded either of them. The list is
 * data about ISO 4217, not about any store, and `scripts/verify-no-client-refs`
 * allowlists this one file for exactly that reason.
 */
const ISO_4217 = new Set(
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN
   BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN
   ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD
   JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT
   MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG
   QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT
   TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XCD XCG XDR
   XOF XPF XSU XTS XUA YER ZAR ZMW ZWG`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * ISO codes that are also ordinary English words this codebase uses as enum
 * values and filter tokens. Excluded so the guard stays usable, listed rather
 * than quietly dropped, and asserted below to exclude nothing the engine can
 * actually run on.
 *
 * ALL Albanian Lek, TOP Tongan Pa'anga, TRY Turkish Lira, SOS Somali Shilling,
 * CUP Cuban Peso. If a client ever trades in one of these, the guard needs a
 * different discriminator, not a longer exclusion list.
 */
const AMBIGUOUS_WITH_ENGLISH = ['ALL', 'TOP', 'TRY', 'SOS', 'CUP'];
for (const code of AMBIGUOUS_WITH_ENGLISH) ISO_4217.delete(code);

const QUOTED_TRIGRAPH = /(['"`])([A-Z]{3})\1/g;

function hardcodesCurrency(source: string): boolean {
  for (const m of source.matchAll(QUOTED_TRIGRAPH)) {
    if (ISO_4217.has(m[2])) return true;
  }
  return false;
}

const INTL_CURRENCY = /style:\s*'currency'/;

describe('admin currency recurrence guard', () => {
  it('has feature files to scan', () => {
    expect(featureFiles.length).toBeGreaterThan(50);
  });

  it('the guard would catch the store currency itself', () => {
    // The property the closed enumeration lacked. Asserted directly, because a
    // recurrence guard that silently stops covering the current currency is
    // worse than no guard: it reports green while the thing it watches for
    // has already happened.
    expect(hardcodesCurrency(`const c = 'XTS';`)).toBe(true);
    expect(hardcodesCurrency(`const c = 'EUR';`)).toBe(true);
    expect(hardcodesCurrency(`const c = 'USD';`)).toBe(true);
    expect(hardcodesCurrency(`const m = 'GET';`)).toBe(false);
    expect(hardcodesCurrency(`const m = 'tnd';`)).toBe(false);
    // Real enum values that share the shape and must not trip the guard.
    for (const token of ['SKU', 'SMS', 'DHL', 'UPS', 'SEO', 'GEO', 'VIP', 'NEW']) {
      expect(hardcodesCurrency(`const t = '${token}';`)).toBe(false);
    }
    // The exclusion list must never contain a currency the engine can run on.
    // Written as an explicit check because the cost of a wrong entry here is a
    // guard that reports green on the one literal it exists to catch.
    expect(AMBIGUOUS_WITH_ENGLISH).not.toContain('XTS');
    expect(AMBIGUOUS_WITH_ENGLISH).not.toContain('EUR');
  });

  it('no feature file hardcodes a currency code', () => {
    const offenders = featureFiles
      .filter((f) => hardcodesCurrency(readFileSync(f, 'utf8')))
      .map((f) => relative(FEATURES_DIR, f));

    // If this fails: read the store currency from CurrencyStore (the `money`
    // pipe, or formatMoney with its config) instead of naming a currency.
    expect(offenders).toEqual([]);
  });

  it('only the shared formatter builds a currency Intl.NumberFormat', () => {
    const appDir = join(__dirname, '..');
    const offenders = collect(appDir)
      .filter((f) => f !== SHARED_FORMATTER)
      .filter((f) => INTL_CURRENCY.test(readFileSync(f, 'utf8')))
      .map((f) => relative(appDir, f));

    // If this fails: delegate to shared/format/money.ts so every screen keeps
    // rendering one format.
    expect(offenders).toEqual([]);
  });
});
