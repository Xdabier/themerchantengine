import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TRANSLATABLE_LOCALES, buildLocaleTabs } from '@admin-ui';
import type { SpecLabelOption } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Observable, of } from 'rxjs';
import {
  ProductSpecsMatrixComponent,
  looseFold,
  toTranslatable,
} from './product-specs-matrix.component';
import type {
  EntityOption,
  EntitySelectPage,
  EntitySelectSource,
} from '../../shared/entity-select/entity-select.types';

expect.extend(toHaveNoViolations);

function labelOption(key: string, fr: string, en: string): EntityOption<SpecLabelOption> {
  return {
    id: key,
    label: fr,
    sublabel: 'used on 3 products',
    value: { key, label: { default: fr, fr, en }, productCount: 3 },
  };
}

class LabelSource implements EntitySelectSource<SpecLabelOption> {
  search(): Observable<EntitySelectPage<SpecLabelOption>> {
    return of({ options: [labelOption('materiau', 'Matériau', 'Material')], total: 1 });
  }
}

@Component({
  standalone: true,
  imports: [ProductSpecsMatrixComponent],
  template: `
    <app-product-specs-matrix
      [specs]="specs()"
      [labelSource]="source"
      [max]="max()"
      (changed)="changes = changes + 1"
    />
  `,
})
class HostComponent {
  readonly specs = signal<
    readonly {
      id: string;
      label: { default: string; [k: string]: string };
      value: { default: string; [k: string]: string };
      key: string;
      valueKey: string;
      sortOrder: number;
    }[]
  >([]);
  readonly max = signal(50);
  readonly source = new LabelSource();
  changes = 0;
}

const ROW = (n: number) => ({
  id: `spec-${n}`,
  label: { default: `Label ${n}`, fr: `Label ${n}`, en: `Label ${n} en` },
  value: { default: `Value ${n}`, fr: `Value ${n}`, en: `Value ${n} en` },
  key: `label-${n}`,
  valueKey: `value-${n}`,
  sortOrder: n,
});

describe('ProductSpecsMatrixComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function matrix(): ProductSpecsMatrixComponent {
    return fixture.debugElement.children[0].componentInstance as ProductSpecsMatrixComponent;
  }
  function el<T extends HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }
  function rowCount(): number {
    return fixture.nativeElement.querySelectorAll('[data-testid^="product-spec-row-"]').length;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: TRANSLATABLE_LOCALES, useValue: signal(buildLocaleTabs(['fr', 'en'], 'fr')) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders one column pair per locale, which is what makes it a matrix', () => {
    host.specs.set([ROW(1)]);
    fixture.detectChanges();
    const headers = [...fixture.nativeElement.querySelectorAll('th')].map((h: HTMLElement) =>
      h.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Label · fr',
      'Label · en',
      'Value · fr',
      'Value · en',
      expect.stringContaining('Actions'),
    ]);
  });

  it('seeds one row per persisted spec, in the order given', () => {
    host.specs.set([ROW(1), ROW(2)]);
    fixture.detectChanges();
    expect(rowCount()).toBe(2);
    expect(
      matrix()
        .toSpecs()
        .map((s) => s.label.default),
    ).toEqual(['Label 1', 'Label 2']);
  });

  it('shows an empty state rather than a blank table when there are none', () => {
    expect(el('[data-testid="product-specs-empty"]')).not.toBeNull();
    expect(rowCount()).toBe(0);
  });

  it('adds and removes rows', () => {
    el<HTMLButtonElement>('[data-testid="product-spec-add"]').click();
    fixture.detectChanges();
    expect(rowCount()).toBe(1);

    el<HTMLButtonElement>('[data-testid="product-spec-remove-0"]').click();
    fixture.detectChanges();
    expect(rowCount()).toBe(0);
  });

  it('stops adding at the cap', () => {
    host.max.set(2);
    fixture.detectChanges();
    el<HTMLButtonElement>('[data-testid="product-spec-add"]').click();
    fixture.detectChanges();
    el<HTMLButtonElement>('[data-testid="product-spec-add"]').click();
    fixture.detectChanges();
    expect(rowCount()).toBe(2);
    expect(el<HTMLButtonElement>('[data-testid="product-spec-add"]').disabled).toBe(true);
  });

  /**
   * sortOrder is the row's position, never an edited field, so reordering has
   * to actually reorder the emitted array.
   */
  it('moving a row down changes the emitted order', () => {
    host.specs.set([ROW(1), ROW(2)]);
    fixture.detectChanges();
    el<HTMLButtonElement>('[data-testid="product-spec-down-0"]').click();
    fixture.detectChanges();
    expect(
      matrix()
        .toSpecs()
        .map((s) => s.label.default),
    ).toEqual(['Label 2', 'Label 1']);
  });

  it('the first row cannot move up and the last cannot move down', () => {
    host.specs.set([ROW(1), ROW(2)]);
    fixture.detectChanges();
    expect(el<HTMLButtonElement>('[data-testid="product-spec-up-0"]').disabled).toBe(true);
    expect(el<HTMLButtonElement>('[data-testid="product-spec-down-1"]').disabled).toBe(true);
  });

  it('announces a move in a live region, since reorder is otherwise silent', () => {
    host.specs.set([ROW(1), ROW(2)]);
    fixture.detectChanges();
    el<HTMLButtonElement>('[data-testid="product-spec-down-0"]').click();
    fixture.detectChanges();
    const status = el('[data-testid="product-specs-status"]');
    expect(status.textContent).toContain('moved to position 2 of 2');
  });

  it('marks BOTH rows when two labels fold together, not just the second', () => {
    host.specs.set([ROW(1), ROW(2)]);
    fixture.detectChanges();
    matrix().rows.at(0).get(['label', 'fr'])!.setValue('Matériau');
    matrix().rows.at(1).get(['label', 'fr'])!.setValue('Materiau');
    el<HTMLButtonElement>('[data-testid="product-spec-add"]').click();
    fixture.detectChanges();

    expect(el('[data-testid="product-spec-duplicate-0"]')).not.toBeNull();
    expect(el('[data-testid="product-spec-duplicate-1"]')).not.toBeNull();
  });

  it('emits changed on add, remove and move so the parent can track dirty', () => {
    const before = host.changes;
    el<HTMLButtonElement>('[data-testid="product-spec-add"]').click();
    fixture.detectChanges();
    expect(host.changes).toBe(before + 1);
  });

  it('reports an incomplete row so the parent can block the save', () => {
    el<HTMLButtonElement>('[data-testid="product-spec-add"]').click();
    fixture.detectChanges();
    expect(matrix().hasIncompleteRow()).toBe(true);

    matrix().rows.at(0).get(['label', 'fr'])!.setValue('Matériau');
    matrix().rows.at(0).get(['value', 'fr'])!.setValue('Titane');
    expect(matrix().hasIncompleteRow()).toBe(false);
  });

  it('has no axe violations with rows present', async () => {
    host.specs.set([ROW(1)]);
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});

describe('toTranslatable', () => {
  const locales = ['fr', 'en'];

  it('mirrors the default locale into default', () => {
    expect(toTranslatable({ fr: 'Matériau', en: 'Material' }, locales)).toEqual({
      default: 'Matériau',
      fr: 'Matériau',
      en: 'Material',
    });
  });

  /**
   * The server folds `key` from `label.default` and rejects an empty one, so a
   * row filled in the second locale only must still produce a usable default
   * rather than being silently unsavable.
   */
  it('falls back to the first filled locale when the default one is blank', () => {
    expect(toTranslatable({ fr: '', en: 'Material' }, locales)).toEqual({
      default: 'Material',
      en: 'Material',
    });
  });

  it('drops blank locales rather than sending empty strings', () => {
    expect(toTranslatable({ fr: 'Matériau', en: '   ' }, locales)).toEqual({
      default: 'Matériau',
      fr: 'Matériau',
    });
  });

  it('produces an empty default when nothing is filled', () => {
    expect(toTranslatable({ fr: '', en: '' }, locales).default).toBe('');
  });

  it('trims, so a space-only cell is not mistaken for content', () => {
    expect(toTranslatable({ fr: '  Matériau  ' }, locales).default).toBe('Matériau');
  });
});

describe('looseFold', () => {
  it('folds accents so two spellings collide, matching the server rule', () => {
    expect(looseFold('Matériau')).toBe(looseFold('Materiau'));
  });

  it('is empty for punctuation-only input, which the grid then ignores', () => {
    expect(looseFold('!!!')).toBe('');
  });
});
