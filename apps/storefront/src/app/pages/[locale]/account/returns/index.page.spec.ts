import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

import { ReturnsService } from '@storefront-services';
import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { assertAxeClean, renderComponent } from '../../../../ui/testing';

import { AccountReturnsPageComponent } from './index.page';

describe('AccountReturnsPageComponent', () => {
  const returnsStub = {
    list: vi.fn(),
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    returnsStub.list.mockReset();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders the SSR shell heading + subheading on server platform', async () => {
    const fixture = await renderComponent(AccountReturnsPageComponent, {}, [
      provideRouter([]),
      LocaleService,
      AuthStateService,
      { provide: ReturnsService, useValue: returnsStub },
      { provide: PLATFORM_ID, useValue: 'server' },
    ]);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="account-returns-page"]')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('axe — zero serious / critical violations on idle SSR shell', async () => {
    const fixture = await renderComponent(AccountReturnsPageComponent, {}, [
      provideRouter([]),
      LocaleService,
      AuthStateService,
      { provide: ReturnsService, useValue: returnsStub },
      { provide: PLATFORM_ID, useValue: 'server' },
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });
});
