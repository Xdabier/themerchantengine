import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { StoreCurrency } from '@admin-services';
import { CurrencyStore } from './currency.store';
import { MoneyAffixStore } from './money-affix.store';
import { StoreSettingsStore, type MoneySymbolPosition } from './store-settings.store';

/**
 * Plan E3.4.3. Every money input in the admin hardcoded the ISO code as an
 * inline-end suffix, so `money.symbolPosition` had no reader anywhere and a
 * store that writes its symbol before the number was contradicted on every
 * form. These cases pin both halves and the unhydrated case, because the rule
 * for an unknown currency is to render nothing rather than to guess one.
 */
function setup(config: StoreCurrency | null, position: MoneySymbolPosition): MoneyAffixStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CurrencyStore,
        useValue: {
          config: signal(config).asReadonly(),
          code: signal(config?.code ?? null).asReadonly(),
        },
      },
      {
        provide: StoreSettingsStore,
        useValue: { symbolPosition: signal(position).asReadonly() },
      },
    ],
  });
  return TestBed.inject(MoneyAffixStore);
}

const EUR: StoreCurrency = { code: 'EUR', symbol: '€', decimalPlaces: 2, enabled: ['EUR'] };
const NO_SYMBOL: StoreCurrency = { code: 'XAF', symbol: '', decimalPlaces: 0, enabled: ['XAF'] };

describe('MoneyAffixStore', () => {
  it('puts the symbol before the number when the store says before', () => {
    const store = setup(EUR, 'before');

    expect(store.prefix()).toBe('€');
    expect(store.suffix()).toBeNull();
  });

  it('puts the symbol after the number when the store says after', () => {
    const store = setup(EUR, 'after');

    expect(store.suffix()).toBe('€');
    expect(store.prefix()).toBeNull();
  });

  it('falls back to the ISO code when the currency carries no symbol', () => {
    const store = setup(NO_SYMBOL, 'before');

    expect(store.prefix()).toBe('XAF');
  });

  it('renders no adornment at all until the currency hydrates', () => {
    const store = setup(null, 'before');

    expect(store.prefix()).toBeNull();
    expect(store.suffix()).toBeNull();
  });

  it('keeps the ISO code available for the accessible name', () => {
    // The adornment is aria-hidden, so the field's label carries the unit and
    // it carries the code rather than a symbol a screen reader may not speak.
    expect(setup(EUR, 'before').code()).toBe('EUR');
  });
});

/**
 * The regression this store exists to prevent, guarded at the source rather
 * than one screen at a time.
 *
 * Every money input in the admin used to bind the ISO code straight to the
 * inline-end adornment, which is how `money.symbolPosition` ended up with no
 * reader anywhere. A new money field that copies the old pattern would be
 * invisible to every screen spec but this one.
 */
/**
 * One `<app-input>` element, whole. Quote-aware rather than lazy to the first
 * `>`, because an attribute value can contain one: `[invalid]="v() > 0"` is
 * already written in this tree, and a truncating match reports a bound field
 * as unbound when the `>` precedes its affix, and skips an unbound one when
 * the `>` precedes its step.
 */
const ELEMENT = /<app-input\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** The step binding's identifier, which is what says whether a field is money. */
const STEP = /\[step\]="([A-Za-z0-9_]+)\(\)"/;

const AFFIX = /\[(prefix|suffix)\]=/;

/**
 * Step names that mean money, and the ones that do not.
 *
 * Held as two lists rather than one, so an identifier on neither fails the
 * spec. A guard that listed only the money names went quiet the moment an
 * author invented a fourth, which is how a discount-value field on the very
 * screen this class was found on twice ended up covered by nothing.
 */
const MONEY_STEPS = new Set(['moneyStep', 'priceStep', 'valueStep', 'amountStep']);
const NOT_MONEY = new Set(['weightStep']);

describe('no money input binds the currency code directly to an adornment', () => {
  /**
   * Every money input carries an affix.
   *
   * The scan below catches a verbatim copy of the old pattern and nothing
   * else, which is how a money field with no affix at all shipped on the
   * promotions screen and survived two reviews: it matched no forbidden text
   * because it bound nothing. A money input is one whose `step` comes from the
   * store currency scale, which is the enumeration E3.4.3 says the rollout was
   * driven from, so that is what this looks for.
   */
  it('finds no money input without a currency affix', () => {
    const features = path.join(__dirname, '..', '..', 'features');
    const offenders: string[] = [];
    const unknownSteps: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          const source = fs.readFileSync(full, 'utf8');
          // Each `<app-input ...>` element, whole, and quote-aware: a lazy
          // match to the first `>` truncates on a comparison inside an
          // attribute, which reports a bound field as an offender when the
          // `>` precedes its affix and skips an unbound one when it precedes
          // its step. Both directions were reachable on templates already in
          // this tree.
          for (const [element] of source.matchAll(ELEMENT)) {
            const step = STEP.exec(element)?.[1];
            if (!step) continue;
            if (NOT_MONEY.has(step)) continue;
            if (!MONEY_STEPS.has(step)) {
              // An unrecognised name is a question, not a pass. The previous
              // shape listed the money names, so a new one made the guard go
              // quiet on a field it had never seen; this way the author has to
              // say which list it belongs on.
              unknownSteps.push(`${full}: [step]="${step}()"`);
              continue;
            }
            if (!AFFIX.test(element)) {
              offenders.push(`${full}: ${element.slice(0, 80).replace(/\s+/g, ' ')}`);
            }
          }
        }
      }
    };
    walk(features);

    expect(unknownSteps).toEqual([]);
    expect(offenders).toEqual([]);
  });

  it('finds no [suffix]="storeCode()" left in the feature templates', () => {
    const features = path.join(__dirname, '..', '..', 'features');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          const source = fs.readFileSync(full, 'utf8');
          if (source.includes('[suffix]="storeCode()"')) offenders.push(full);
        }
      }
    };
    walk(features);

    expect(offenders).toEqual([]);
  });
});
