---
title: Add a settings tab
description: "Add a screen under Settings in the Angular admin: the card on the settings home, the child route, the per-screen form over the settings service and its Zod schema, and the e2e journey that saves and restores."
primaryQuery: add a settings tab angular admin dashboard
updated: 2026-09-09
schema: HowTo
---

## When you need this

The store needs a new group of configuration that operators edit in the admin. You end up with a card on `/settings`, a child route, a page that seeds a form from `GET /v1/admin/settings`, sends only the changed keys with `PATCH /v1/admin/settings`, and a Playwright journey that proves the round trip. The worked example is the money screen at `/settings/money`.

Settings is not a tab strip. `apps/admin/src/app/features/settings/settings-home.page.ts` is a static grid of cards, and every card links to a focused sub-route; there is no shared settings shell component around the pages.

## Files you touch

- `apps/admin/src/app/features/settings/settings-home.page.ts`: the `cards` array. One entry per screen, with its permission.
- `apps/admin/src/app/app.routes.ts`: the child under `path: 'settings'`.
- `apps/admin/src/app/features/settings/settings-money.page.ts`: the page. Breadcrumb, form, sticky footer with Revert and Save.
- `apps/admin/src/app/features/settings/settings-money.page.spec.ts`: the page spec.
- `apps/admin/src/app/features/settings/settings.utils.ts`: `readSetting()` for reading one key out of the grouped envelope.
- `libs/admin-services/src/settings/settings.service.ts`: `getAll()` and `update()`. Already there; you add keys to its schema, not methods.
- `libs/admin-services/src/settings/settings.schemas.ts` and `settings.schemas.spec.ts`: the request schema and its per-key spec.
- `apps/admin-e2e/src/modules/settings-config.journey.spec.ts`: the save-and-restore journey.
- `apps/api/src/modules/settings/dto/update-settings.dto.ts`: the API side of the same key. Not covered here; see the API recipe [Add a settings key](../api/add-a-settings-key.md).

## The pattern

### 1. Register the card

`apps/admin/src/app/features/settings/settings-home.page.ts` renders every card, and a card the operator cannot open still renders, greyed out with the permission it needs:

```ts
  protected readonly cards: SettingsCard[] = [
    {
      path: '/settings/money',
      title: 'Money',
      description: 'Currency and symbol, separators, display precision, tax display and VAT rate.',
      permission: 'settings:view',
    },
```

```html
@if (canAccess(card.permission)) {
  <li>
    <a [routerLink]="card.path" [attr.data-testid]="'settings-card-' + card.path.split('/').pop()">
```

### 2. Add the child route

The `settings` parent in `apps/admin/src/app/app.routes.ts` is guarded by `settings:view`; a child adds its own guard only when it needs a stronger permission (integrations does).

```ts
      {
        path: 'settings',
        canActivate: [permissionGuard('settings:view')],
        data: { title: 'Settings', permission: 'settings:view' },
        children: [
          {
            path: 'money',
            loadComponent: () =>
              import('./features/settings/settings-money.page').then((m) => m.SettingsMoneyPage),
            data: { title: 'Money' },
          },
          {
            path: 'integrations',
            canActivate: [permissionGuard('settings:manage')],
            loadComponent: () =>
              import('./features/settings/settings-integrations.page').then((m) => m.SettingsIntegrationsPage),
            data: { title: 'Integrations', permission: 'settings:manage' },
          },
```

### 3. One service, grouped response

`libs/admin-services/src/settings/settings.service.ts` has two calls every settings screen shares:

```ts
  /** GET /v1/admin/settings */
  getAll(): Observable<SettingsResponse> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(SETTINGS.base)}`, { withCredentials: true })
      .pipe(map((raw) => settingsResponseSchema.parse(envelope(raw))));
  }

  update(input: UpdateSettingsRequest): Observable<SettingsResponse> {
    let body: UpdateSettingsRequest;
    try {
      body = updateSettingsRequestSchema.parse(input);
    } catch (err) {
      return throwError(() => err);
    }
    if (Object.keys(body).length === 0) {
      const dropped = Object.keys(input as Record<string, unknown>);
      return throwError(() => new Error(
        `SettingsService.update: no recognised settings in the request body. ` +
        `Dropped by updateSettingsRequestSchema: ${dropped.length ? dropped.join(', ') : '(nothing sent)'}.`,
      ));
    }
```

The response is grouped (`general`, `localization`, `money`, ...). `apps/admin/src/app/features/settings/settings.utils.ts` reads one key with a fallback rather than typing the whole envelope:

```ts
export function readSetting<T>(settings: SettingsResponse | null, group: string, key: string, fallback: T): T {
  if (!settings) return fallback;
  const g = settings[group];
  if (!g || typeof g !== 'object') return fallback;
  const v = (g as Record<string, unknown>)[key];
  return v === undefined || v === null ? fallback : (v as T);
}
```

The group name is decided on the API side: `SETTINGS_KEYS` in `apps/api/src/modules/settings/settings.constants.ts:25` lists every key under its group, and `KEY_TO_GROUP` (line 121) is what the API uses to store and to group the response. Read the group from there, not from where the key seems to belong: `currencyConfig` lives under `localization`, not `money`. `readSetting` with a wrong group returns the fallback and nothing fails; the form seeds with the default, the footer says "No changes", and the stored value never shows.

### 4. Seed the form, send only what changed

`apps/admin/src/app/features/settings/settings-money.page.ts` loads on init, resets the form from the response without emitting, and on save builds a body from the dirty controls only. Both excerpts are abridged: `save()` is at lines 386-437 and `seedForm` at lines 483-510, and the real ones also carry `symbol`, `decimalPlaces` and the `currencyConfig` object.

```ts
  private seedForm(settings: SettingsResponse): void {
    this.form.reset(
      {
        symbolPosition: readSetting<string>(settings, 'money', 'symbolPosition', STORE_CONFIG_SYMBOL_POSITIONS[0]),
        decimalSeparator: readSetting<string>(settings, 'money', 'decimalSeparator', '.'),
        thousandsSeparator: readSetting<string>(settings, 'money', 'thousandsSeparator', ','),
        taxDisplay: readSetting<string>(settings, 'money', 'taxDisplay', 'none'),
        vatRate: readSetting<number>(settings, 'money', 'vatRate', 0),
      },
      { emitEvent: false },
    );
  }

  save(): void {
    const raw = this.form.getRawValue();
    const body: UpdateSettingsRequest = {};
    if (this.form.controls.decimalSeparator.dirty) body.decimalSeparator = raw.decimalSeparator;
    if (this.form.controls.vatRate.dirty) body.vatRate = Number(raw.vatRate);

    this.service.update(body).subscribe({
      next: (next) => {
        this.current.set(next);
        this.seedForm(next);
        this.currencyStore.refresh();
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
```

The footer is the same on every settings page: a "Unsaved changes" / "No changes" label, Revert (re-seeds from the last loaded response) and Save, both gated on `form.dirty`:

```html
<footer class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap">
  <p class="text-xs tabular text-ink-muted">{{ form.dirty ? 'Unsaved changes' : 'No changes' }}</p>
  <app-button type="button" variant="ghost" size="sm" [disabled]="busy() || !form.dirty" (clicked)="revert()">Revert</app-button>
  <app-button type="submit" variant="primary" size="md" [disabled]="form.invalid || busy() || !form.dirty || !canManage()" [loading]="busy()">Save</app-button>
</footer>
```

### 5. Unsaved changes

There is no unsaved-changes guard. No settings route registers a `canDeactivate`, and nothing listens to `beforeunload`; the footer label is the only signal that the form is dirty. Navigating away discards the edit without a prompt. If your screen needs one, it is new code, not a pattern to copy.

### 6. The journey

`apps/admin-e2e/src/modules/settings-config.journey.spec.ts` reads the current values through the API, drives the screen, reloads, and restores in `finally`:

```ts
test('settings-money: the format saves, the sample follows it, and it restores', async ({ page, baseURL }) => {
  const before = await readSettings(baseURL!);
  const original = before['money'] as Record<string, unknown>;
  try {
    await openSettings(page, '/settings/money', 'settings-money-page');
    await page.selectOption('[data-testid="settings-money-symbol-position"]', 'before');
    await page.click('[data-testid="settings-money-save"]');
    await expect(page.locator('[data-testid="settings-money-notice"]')).toContainText('saved');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="settings-money-symbol-position"]')).toHaveValue('before');
  } finally {
    await patchSettings(baseURL!, {
      symbolPosition: original['symbolPosition'],
      decimalSeparator: original['decimalSeparator'],
      thousandsSeparator: original['thousandsSeparator'],
      taxDisplay: original['taxDisplay'],
      vatRate: original['vatRate'],
    });
  }
});
```

## Tests to run

```bash
npx nx test admin-services
npx nx test admin
npx nx lint admin
npx nx build admin --configuration=production
npx nx e2e admin-e2e --grep settings
```

- `npx nx test admin-services` runs `settings.schemas.spec.ts`, which reads the API DTO file and fails when the Zod schema models a different set of keys.
- `npx nx test admin` runs the page spec (seeding, dirty-only body, each validator, axe). A page that injects `CurrencyStore`, as the money page does, provides `provideCurrencyStoreStub()` from `apps/admin/src/testing/currency-store.mock.ts` in its `TestBed`; the real store's constructor effect (`apps/admin/src/app/core/stores/currency.store.ts:59-70`) calls `CurrenciesService` as soon as the seeded `AuthStore` reports a session, and the stub is what keeps that request out of the spec.
- `npx nx lint admin` covers the template.
- `npx nx build admin --configuration=production` is the strict-template gate.
- `npx nx e2e admin-e2e --grep settings` runs every settings journey and the settings smoke against the real API.

## Gotchas

- The request schema strips unknown keys. A page that sends only a key the schema does not model gets an error from the service; a page that sends it beside a modelled key gets a 200 and a value that was never stored. Add the key to `updateSettingsRequestSchema` first.
- `settings.schemas.spec.ts` parses `apps/api/src/modules/settings/dto/update-settings.dto.ts` and compares property lists. A key added on one side only fails there.
- Two keys can live in one stored object. The money screen sends `currencyConfig` as a whole (`code`, `symbol`, `decimalPlaces`) because the API replaces that object, so a symbol change must carry the code the currencies screen owns.
- Other stores cache what settings feeds them. After a save, the money page calls `currencyStore.refresh()`; a screen that changes something another store reads must do the same or the rest of the admin keeps the old value until a full reload.
- `form.reset(values, { emitEvent: false })` is how seeding avoids marking the form dirty and avoids firing `valueChanges` subscribers on load.
- The parent route is `settings:view`. A screen that must not be visible to a viewer needs its own `permissionGuard` and a matching card `permission`, as `/settings/integrations` does with `settings:manage`.
- Provider secrets (mail, S3, Turnstile) are not settings. They live in the environment and change by re-running the installer; see [Store settings, secrets and integrations](../../../operate/store-settings.md).
