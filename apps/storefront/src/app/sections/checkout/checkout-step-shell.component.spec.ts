import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../locale.service';
import { getChromeStrings } from '../../../i18n';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { CheckoutStepShellComponent } from './checkout-step-shell.component';

@Component({
  standalone: true,
  imports: [CheckoutStepShellComponent],
  template: `
    <app-checkout-step-shell
      [step]="1"
      title="Delivery address"
      [state]="state"
      [summaryText]="summary"
      (editClicked)="edits = edits + 1"
    >
      <p data-testid="step-body">step body content</p>
    </app-checkout-step-shell>
  `,
})
class HostComponent {
  state: 'pristine' | 'active' | 'complete' | 'invalid' = 'active';
  summary: string | null = null;
  edits = 0;
}

describe('CheckoutStepShellComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the title as an h2 with a stable id for aria-labelledby', async () => {
    const fixture = await renderComponent(HostComponent, {}, [provideRouter([]), LocaleService]);
    const h2 = fixture.nativeElement.querySelector('h2.title') as HTMLElement;
    expect(h2.id).toBe('checkout-step-1-title');
    expect(h2.textContent?.trim()).toBe('Delivery address');
    const region = fixture.nativeElement.querySelector('section.step') as HTMLElement;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-labelledby')).toBe('checkout-step-1-title');
  });

  it('projects the body slot when state is active', async () => {
    const fixture = await renderComponent(HostComponent, {}, [provideRouter([]), LocaleService]);
    expect(fixture.nativeElement.querySelector('[data-testid="step-body"]')).not.toBeNull();
  });

  it('hides the body slot when state is complete and surfaces an edit button', async () => {
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      {
        step: 1,
        title: 'Delivery address',
        state: 'complete',
        summaryText: 'Lyon, QA',
      },
      [provideRouter([]), LocaleService],
    );
    expect(fixture.nativeElement.querySelector('.body')).toBeNull();
    const summary = fixture.nativeElement.querySelector(
      '[data-testid="checkout-step-summary"]',
    ) as HTMLElement;
    expect(summary.textContent?.trim()).toBe('Lyon, QA');
    const edit = fixture.nativeElement.querySelector(
      '[data-testid="checkout-step-edit"]',
    ) as HTMLButtonElement;
    expect(edit).not.toBeNull();
    expect(edit.getAttribute('aria-label')).toContain('Delivery address');
  });

  it('labels a completed step with a state word, not the order-summary title', async () => {
    // `stateLabel` returned `checkout.steps.summary.title` for every completed
    // step, so the delivery-address step's chip read "Order summary" and the
    // active step's chip just repeated its own heading. A chip carries state.
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      { step: 1, title: 'Delivery address', state: 'complete' },
      [LocaleService],
    );
    const badge = fixture.nativeElement.querySelector('.badge');
    expect(badge?.textContent?.trim()).toBe('Terminée');
    // Finding K1: a state word short enough to read at a glance beside a title.
    expect(getChromeStrings('en').checkout.steps.stepState.complete).toBe('Done');
    expect(badge?.textContent).not.toContain('Récapitulatif');
  });

  it('labels the active step with an in-progress word, not its own heading', async () => {
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      { step: 2, title: 'Récapitulatif', state: 'active' },
      [LocaleService],
    );
    const badge = fixture.nativeElement.querySelector('.badge');
    expect(badge?.textContent?.trim()).toBe('En cours');
    expect(getChromeStrings('en').checkout.steps.stepState.inProgress).toBe('Current');
    expect(badge?.textContent?.trim()).not.toBe('Récapitulatif');
  });

  it('names the step it edits, so every edit button is not the same label', async () => {
    // The aria-label reused the address step's Edit string for every step.
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      { step: 2, title: 'Récapitulatif', state: 'complete' },
      [LocaleService],
    );
    const edit = fixture.nativeElement.querySelector('[data-testid="checkout-step-edit"]');
    expect(edit?.getAttribute('aria-label')).toContain('Récapitulatif');
    // No em-dash: the charte forbids it and it read as a separator in a label.
    expect(edit?.getAttribute('aria-label')).not.toContain(String.fromCodePoint(0x2014));
  });

  it('emits editClicked when the edit button is pressed', async () => {
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      {
        step: 1,
        title: 'Delivery address',
        state: 'complete',
        summaryText: 'X',
      },
      [provideRouter([]), LocaleService],
    );
    let count = 0;
    fixture.componentInstance.editClicked.subscribe(() => count++);
    const edit = fixture.nativeElement.querySelector(
      '[data-testid="checkout-step-edit"]',
    ) as HTMLButtonElement;
    edit.click();
    expect(count).toBe(1);
  });

  for (const state of ['pristine', 'active', 'complete', 'invalid'] as const) {
    it(`renders zero serious or critical axe violations when state is ${state}`, async () => {
      TestBed.resetTestingModule();
      const fixture = await renderComponent(
        CheckoutStepShellComponent,
        {
          step: 1,
          title: 'Delivery address',
          state,
          summaryText: state === 'complete' ? 'Lyon, QA' : null,
        },
        [provideRouter([]), LocaleService],
      );
      await assertAxeClean(fixture.nativeElement, {
        disabledRules: ['html-has-lang', 'landmark-one-main', 'region', 'heading-order'],
      });
    });
  }
});

/**
 * Finding K2 (plan L Phase L4).
 *
 * A pristine step has no state word, so the badge rendered as an empty span
 * with a 1px border and padding: the outlined blank box QA saw on the steps it
 * had not reached yet. No badge is the honest rendering of no state.
 */
describe('CheckoutStepShellComponent pristine badge', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders no badge element on a pristine step', async () => {
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      { step: 2, title: 'Delivery method', state: 'pristine' },
      [provideRouter([]), LocaleService],
    );
    expect(fixture.nativeElement.querySelector('.badge')).toBeNull();
  });

  it('still renders the badge once the step carries a state', async () => {
    const fixture = await renderComponent(
      CheckoutStepShellComponent,
      { step: 2, title: 'Delivery method', state: 'active' },
      [provideRouter([]), LocaleService],
    );
    const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent?.trim()).not.toBe('');
  });
});
