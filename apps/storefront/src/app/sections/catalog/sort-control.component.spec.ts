import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { SortControlComponent, type CatalogSortChange } from './sort-control.component';

describe('SortControlComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the four sort options with the locale chrome label', async () => {
    const fixture = await renderComponent(SortControlComponent, { current: 'newest' }, [
      provideRouter([]),
      LocaleService,
    ]);
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.options.length).toBe(4);
    expect(select.options[0].value).toBe('newest');
    expect(select.options[1].value).toBe('priceAsc');
    expect(select.options[2].value).toBe('priceDesc');
    expect(select.options[3].value).toBe('nameAsc');
    expect(select.value).toBe('newest');
    const label = fixture.nativeElement.querySelector('.label');
    expect(label?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('emits a sortChange with mapped sortBy + sortOrder when value changes', async () => {
    const fixture = await renderComponent(SortControlComponent, { current: 'newest' }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: CatalogSortChange | null = null;
    fixture.componentInstance.sortChange.subscribe((change: CatalogSortChange) => {
      received = change;
    });
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'priceAsc';
    select.dispatchEvent(new Event('change'));
    expect(received).not.toBeNull();
    expect(received).toMatchObject({ key: 'priceAsc', sortBy: 'price', sortOrder: 'asc' });
  });

  it('reflects the current input on the select element', async () => {
    const fixture = await renderComponent(SortControlComponent, { current: 'priceDesc' }, [
      provideRouter([]),
      LocaleService,
    ]);
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('priceDesc');
  });

  it('passes axe with a labelled select', async () => {
    const fixture = await renderComponent(SortControlComponent, { current: 'newest' }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });
});
