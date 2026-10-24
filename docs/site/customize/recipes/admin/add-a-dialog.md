---
title: Add a dialog
description: "Open a modal in the Angular admin on the CDK dialog primitive: pass data in, get a typed result out, keep the focus trap and Escape behaviour CDK provides, and style it inside the brand rules."
primaryQuery: add a dialog angular cdk admin dashboard
updated: 2026-09-09
schema: HowTo
---

## When you need this

A screen needs a confirmation before a destructive call, or a small form that should not be a route. You end up with either a call to `openConfirmDialog` (two buttons, a typed boolean back) or a component of your own opened through `Dialog.open` with a data object in and a typed result out. Both sit on `@angular/cdk/dialog`, which owns the overlay, the focus trap, Escape and the backdrop click. The worked examples are the page delete in the CMS list and the attribute editor in the products area.

## Files you touch

- `libs/admin-ui/src/organisms/dialog/dialog.component.ts`: `ConfirmDialogComponent`, `ConfirmDialogData` and the `openConfirmDialog` helper.
- `libs/admin-ui/src/organisms/dialog/dialog.component.spec.ts`: the confirm dialog's spec, a model for testing your own.
- `apps/admin/src/app/features/cms/pages-list.page.ts`: a destructive confirm before `DELETE`.
- `apps/admin/src/app/features/products/attribute-dialog.component.ts`: a custom dialog with a form, `DIALOG_DATA` in and `DialogRef.close(result)` out.
- `apps/admin/src/app/features/products/attributes-list.page.ts`: the opener that subscribes to `ref.closed`.
- `apps/admin/src/styles.css`: the backdrop rule and the side-panel pane rule.
- `apps/admin-e2e/src/modules/dialog-chrome.journey.spec.ts`: the e2e that proves the backdrop dims the page.

## The pattern

### 1. A confirmation: `openConfirmDialog`

`libs/admin-ui/src/organisms/dialog/dialog.component.ts` wraps CDK for the common case. It returns a promise of the boolean the dialog closed with; Escape and a backdrop click close with `undefined`, which the helper turns into `false`. The excerpt is abridged: lines 91-93 of the helper derive `titleId` and `bodyId` from a per-call counter (`dlg-<n>-title`, `dlg-<n>-body`) unless the caller passes its own.

```ts
export interface ConfirmDialogData {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'neutral' | 'destructive';
}

export async function openConfirmDialog(dialog: Dialog, data: ConfirmDialogData): Promise<boolean> {
  const ref = dialog.open<boolean>(ConfirmDialogComponent, {
    data: { ...data, titleId, bodyId },
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    ariaModal: true,
    role: 'dialog',
    ariaLabel: data.title,
    ariaLabelledBy: titleId,
    ariaDescribedBy: data.body ? bodyId : undefined,
    hasBackdrop: true,
    disableClose: false,
  });
  return (await firstValue(ref.closed)) ?? false;
}
```

`apps/admin/src/app/features/cms/pages-list.page.ts` uses it before the delete call. `tone: 'destructive'` swaps the confirm button to the destructive variant.

```ts
  private readonly dialog = inject(Dialog);

  async confirmDelete(item: CmsPage): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this page?',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deletingId.set(item.id);
    this.cms.delete(item.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.deletingId.set(null); this.fetch(); },
      error: (err: unknown) => { this.deletingId.set(null); this.error.set(this.formatError(err)); },
    });
  }
```

### 2. Your own dialog: data in, typed result out

`apps/admin/src/app/features/products/attribute-dialog.component.ts` declares what goes in and what comes out, injects both CDK handles, and closes with the result:

```ts
export interface AttributeDialogData {
  mode: 'create' | 'edit';
  attribute?: Attribute;
  productTypes: readonly ProductType[];
  defaultProductTypeId?: string | null;
}

export type AttributeDialogResult = { kind: 'saved'; attribute: Attribute } | null;

export class AttributeDialogComponent {
  private readonly ref = inject<DialogRef<AttributeDialogResult>>(DialogRef);

  constructor(@Inject(DIALOG_DATA) public readonly data: AttributeDialogData) {
```

```ts
        this.ref.close({ kind: 'saved', attribute });
```

```ts
    this.ref.close(null);
```

The opener in `apps/admin/src/app/features/products/attributes-list.page.ts` names the heading id so the dialog has an accessible name, then subscribes to `closed`:

```ts
  private openDialog(data: AttributeDialogData): void {
    const ref = this.dialog.open<AttributeDialogResult>(AttributeDialogComponent, {
      data,
      panelClass: 'cdk-overlay-panel-brand',
      backdropClass: 'cdk-overlay-backdrop-brand',
      ariaModal: true,
      ariaLabelledBy: 'attribute-dialog-title',
    });
    ref.closed.pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (result?.kind === 'saved') this.fetch();
    });
  }
```

The dialog's template carries `<h2 id="attribute-dialog-title">` to match.

### 3. What CDK gives you

With `disableClose: false` (the CDK default, and what every opener in the tree passes), the installed `@angular/cdk` dialog:

- closes on Escape without a modifier key, with an `undefined` result;
- closes on a backdrop click, same result; when close is refused it recaptures focus inside the pane;
- moves focus to the first tabbable element on open (`autoFocus: 'first-tabbable'`) and traps Tab inside the pane;
- returns focus to the element that opened it on close (`restoreFocus: true`);
- closes on navigation (`closeOnNavigation: true`).

None of that is admin code. Do not add key handlers or focus code to a dialog component; give it a heading id and real buttons.

### 4. Styling

`backdropClass: 'cdk-overlay-backdrop-brand'` is what makes a modal read as modal. `apps/admin/src/styles.css` supplies the colour and nothing else; CDK's prebuilt CSS keeps the positioning and the opacity transition:

```css
.cdk-overlay-backdrop.cdk-overlay-backdrop-brand {
  /* Deliberately Void Black in both colour modes: a scrim's job is to sink
     the page behind the dialog, and a Paper White scrim on a Paper White
     ground sinks nothing. */
  background: color-mix(in srgb, var(--color-void-black) 72%, transparent);
}
```

`panelClass: 'cdk-overlay-panel-brand'` has no rule in `styles.css`; the dialog's root element brings its own surface. The confirm dialog's root is the whole style:

```html
<div class="w-full max-w-md bg-surface border border-line p-6">
```

For a drawer from the inline end, pass `panelClass: 'side-panel-right'`, which `styles.css` pins with `position: fixed !important`, `inset-inline-end: 0` and a `28rem` width, because CDK's global position strategy writes `position: static` inline and would otherwise centre it.

The rules a dialog cannot break: semantic tokens only (`bg-surface`, `text-ink`, `border-line`; a palette token or a hex anywhere under `apps/admin/src` or `libs/admin-ui/src` fails `apps/admin/src/palette-token.guard.spec.ts`), zero border radius (`styles.css` resets it on every element with `!important` and `apps/admin-e2e/src/design-system.spec.ts` measures it), no gradients (`backgroundImage` is disabled in `apps/admin/tailwind.config.js`), buttons through `app-button`.

### 5. Test it

`libs/admin-ui/src/organisms/dialog/dialog.component.spec.ts` shows the shape: a host component opens the dialog, the spec finds `[role="dialog"]` on `document.body`, clicks, and awaits the result.

```ts
    const dialogEl = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(dialogEl.textContent).toContain('Delete product?');

    const confirm = buttons.find((b) => b.textContent?.includes('Delete'))!;
    confirm.click();
    await promise;
    expect(fixture.componentInstance.lastResult()).toBe(true);
```

A dialog of your own is tested in two shapes. The one every custom dialog spec in the tree uses (`apps/admin/src/app/features/products/attribute-dialog.component.spec.ts:30-43`) creates the component directly and stubs both CDK handles, so the assertion is on what `close` was called with:

```ts
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close: closeSpy } },
        {
          provide: ProductsService,
          useValue: { createAttribute: createSpy, updateAttribute: updateSpy },
        },
      ],
    });
    fixture = TestBed.createComponent(AttributeDialogComponent);
```

The other shape is the helper spec above, adapted: a host component calls `dialog.open(...)` and writes `ref.closed.subscribe(...)` into a signal, the spec awaits `fixture.whenStable()` and runs `detectChanges()`, finds the pane on `document.body`, clicks the action, awaits `whenStable()` again and reads the signal. That one proves the result travels through CDK, which the stub cannot.

The click target inside a dialog is the native button, not the `app-button` element. `libs/admin-ui/src/atoms/button/button.component.ts` binds `[attr.data-testid]="testId()"` on its inner `<button>` (line 51) and declares `testId` as an input (line 73), so in a template write `testId="dlg-confirm"` and select `[data-testid="dlg-confirm"]`. A plain `data-testid="..."` attribute on `<app-button>` stays on the wrapper element; a Jest `querySelector` on it returns the host, not the button it needs to click.

In Playwright, `apps/admin-e2e/src/modules/assets-references.journey.spec.ts` runs axe scoped to the dialog and proves Escape closes it:

```ts
    await injectAxe(page);
    await checkA11y(page, '[data-testid="asset-references-dialog"]', { detailedReport: false });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
```

## Tests to run

```bash
npx nx test admin-ui
npx nx test admin
npx nx lint admin
npx nx e2e admin-e2e --grep dialog
```

- `npx nx test admin-ui` runs the dialog primitive's spec (title, body, tones, cancel and confirm results).
- `npx nx test admin` runs your dialog component's spec and the palette-token guard, which fails on a hex or a palette token in your template.
- `npx nx lint admin` covers the template.
- `npx nx e2e admin-e2e --grep dialog` runs `dialog-chrome.journey.spec.ts`, which measures the backdrop's alpha in a real browser and fails when a dialog opens without the brand scrim.

## Gotchas

- Forget `backdropClass: 'cdk-overlay-backdrop-brand'` and the backdrop renders fully transparent; the page behind does not dim and the e2e chrome spec fails. That is the defect the spec was written for.
- A `panelClass` that is a string of Tailwind utilities does nothing: Tailwind does not see class names inside a `.ts` string passed to CDK at runtime, so the pane keeps its auto width and Playwright reports it hidden. Put a real rule in `styles.css`, as `side-panel-right` is.
- Pass `ariaLabelledBy` with an id the dialog's heading really carries. The confirm helper generates the pair itself; a custom dialog hardcodes the id in both places.
- `openConfirmDialog` returns `false` for Escape and for a backdrop click, not only for Cancel. Do not read `false` as "the operator pressed Cancel".
- A dialog with a form is subject to the same rule as any form: no `computed()` over a form getter. See [Add a form field](./add-a-form-field.md).
- The scrim is Void Black in light mode too. Do not switch it to a light colour to "match the theme".
- `ref.closed` emits once. Subscribe before the operator can close the dialog; opening and subscribing in the same synchronous block, as the attribute opener does, is enough.
