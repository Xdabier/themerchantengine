import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CategoriesService } from '@admin-services';
import { ApiForbiddenError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CategoryPickerComponent } from './category-picker.component';

expect.extend(toHaveNoViolations);

const TREE = [
  {
    id: 'cat-1',
    name: { default: 'Soins', fr: 'Soins', en: 'Care' },
    slug: 'soins',
    children: [
      {
        id: 'cat-1-1',
        name: { default: 'Brosses', fr: 'Brosses', en: 'Brushes' },
        slug: 'brosses',
      },
    ],
  },
  { id: 'cat-2', name: { default: 'Outils', fr: 'Outils', en: 'Tools' }, slug: 'outils' },
];

describe('CategoryPickerComponent', () => {
  let fixture: ComponentFixture<CategoryPickerComponent>;
  let treeSpy: jest.Mock;

  function configure(selected: readonly string[] = []) {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CategoriesService, useValue: { tree: treeSpy } },
      ],
    });
    TestBed.inject(AuthStore);
    fixture = TestBed.createComponent(CategoryPickerComponent);
    fixture.componentRef.setInput('selectedIds', selected);
    fixture.detectChanges();
  }

  beforeEach(() => {
    treeSpy = jest.fn(() => of(TREE));
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders every node flattened, with the child indented', () => {
    configure();
    const boxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(3);
    const labels = [...fixture.nativeElement.querySelectorAll('label span')].map((s: HTMLElement) =>
      s.textContent?.trim(),
    );
    expect(labels).toEqual(['Soins', 'Brosses', 'Outils']);
  });

  it('pre-checks the ids it was given', () => {
    configure(['cat-2']);
    const checked = [
      ...fixture.nativeElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].filter((b) => b.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute('data-testid')).toBe('product-category-cat-2');
  });

  it('emits the union when a box is ticked, keeping what was already selected', () => {
    configure(['cat-1']);
    const emitted: readonly string[][] = [];
    fixture.componentInstance.selectionChange.subscribe((v) => emitted.push([...v]));
    const box = fixture.nativeElement.querySelector<HTMLInputElement>(
      '[data-testid="product-category-cat-2"]',
    )!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([['cat-1', 'cat-2']]);
  });

  it('emits without the id when a box is unticked', () => {
    configure(['cat-1', 'cat-2']);
    const emitted: readonly string[][] = [];
    fixture.componentInstance.selectionChange.subscribe((v) => emitted.push([...v]));
    const box = fixture.nativeElement.querySelector<HTMLInputElement>(
      '[data-testid="product-category-cat-1"]',
    )!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([['cat-2']]);
  });

  /**
   * The guard that matters. A 403 on the tree must not read as "no categories
   * assigned", and must not be able to produce a selection change: the product
   * update replaces the set, so one emission from a degraded picker would
   * detach every category the product has.
   */
  it('degrades to a read-only notice on a forbidden tree, and never emits', () => {
    treeSpy = jest.fn(() => throwError(() => new ApiForbiddenError('nope')));
    configure(['cat-1']);
    const emitted: unknown[] = [];
    fixture.componentInstance.selectionChange.subscribe((v) => emitted.push(v));

    const degraded = fixture.nativeElement.querySelector(
      '[data-testid="category-picker-degraded"]',
    );
    expect(degraded).not.toBeNull();
    expect(degraded.textContent).toContain('do not have permission');
    expect(fixture.nativeElement.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(emitted).toEqual([]);
  });

  it('degrades on a non-permission failure too', () => {
    treeSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    const degraded = fixture.nativeElement.querySelector(
      '[data-testid="category-picker-degraded"]',
    );
    expect(degraded).not.toBeNull();
    expect(degraded.textContent).toContain('Could not load categories');
  });

  it('shows an empty state when no categories exist', () => {
    treeSpy = jest.fn(() => of([]));
    configure();
    expect(
      fixture.nativeElement.querySelector('[data-testid="category-picker-empty"]'),
    ).not.toBeNull();
  });

  it('does not emit while disabled', () => {
    configure(['cat-1']);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const emitted: unknown[] = [];
    fixture.componentInstance.selectionChange.subscribe((v) => emitted.push(v));
    const box = fixture.nativeElement.querySelector<HTMLInputElement>(
      '[data-testid="product-category-cat-2"]',
    )!;
    box.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([]);
  });

  it('has no axe violations', async () => {
    configure(['cat-1']);
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
