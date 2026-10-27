import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CategoriesService, ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { NEVER, of } from 'rxjs';
import { PromotionScopeEditorComponent } from './promotion-scope.component';

expect.extend(toHaveNoViolations);

const categoryTree = [
  {
    id: 'c1',
    name: { default: 'Apparel', en: 'Apparel' },
    slug: 'apparel',
    productCount: 0,
    isVisible: true,
    children: [
      {
        id: 'c2',
        name: { default: 'Shoes', en: 'Shoes' },
        slug: 'shoes',
        productCount: 0,
        isVisible: true,
        children: [],
      },
    ],
  },
];

const productFixture = {
  id: 'p1',
  name: { default: 'Sneaker', en: 'Sneaker' },
  slug: 'sneaker',
};

describe('PromotionScopeEditorComponent', () => {
  let fixture: ComponentFixture<PromotionScopeEditorComponent>;
  let page: PromotionScopeEditorComponent;
  let treeSpy: jest.Mock;
  let listSpy: jest.Mock;
  let getSpy: jest.Mock;

  function configure(opts: { productIds?: string[]; categoryIds?: string[] } = {}) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CategoriesService, useValue: { tree: treeSpy } },
        {
          provide: ProductsService,
          useValue: { listProducts: listSpy, getProduct: getSpy },
        },
      ],
    });
    fixture = TestBed.createComponent(PromotionScopeEditorComponent);
    page = fixture.componentInstance;
    fixture.componentRef.setInput('initialProductIds', opts.productIds ?? []);
    fixture.componentRef.setInput('initialCategoryIds', opts.categoryIds ?? []);
    fixture.detectChanges();
  }

  beforeEach(() => {
    treeSpy = jest.fn(() => of(categoryTree));
    listSpy = jest.fn(() =>
      of({ data: [productFixture], meta: { page: 1, pageSize: 20, total: 1 } }),
    );
    getSpy = jest.fn((id: string) => of({ ...productFixture, id }));
  });

  it('flattens the category tree for the checkbox list', () => {
    configure();
    expect(page.categoryList().map((n) => n.id)).toEqual(['c1', 'c2']);
  });

  it('seeds selected category ids from the initial input', () => {
    configure({ categoryIds: ['c1'] });
    expect(page.selectedCategoryIds().has('c1')).toBe(true);
    expect(page.selectedCategoryIds().has('c2')).toBe(false);
  });

  it('emits on category toggle', () => {
    configure();
    const emitted: { productIds: string[]; categoryIds: string[] }[] = [];
    page.changed.subscribe((v) => emitted.push(v));
    const evt = { target: { checked: true } } as unknown as Event;
    page.toggleCategory('c1', evt);
    expect(emitted.at(-1)?.categoryIds).toEqual(['c1']);
  });

  it('tracks product selection via toggleProduct', () => {
    configure();
    const emitted: { productIds: string[]; categoryIds: string[] }[] = [];
    page.changed.subscribe((v) => emitted.push(v));
    const evt = { target: { checked: true } } as unknown as Event;
    page.toggleProduct(productFixture as never, evt);
    expect(emitted.at(-1)?.productIds).toEqual(['p1']);
  });

  it('seeds an id placeholder with no locale key and hydrates it from the service', () => {
    getSpy.mockReturnValue(NEVER);
    configure({ productIds: ['p9'] });
    expect(page.selectedProducts()[0].name).toEqual({ default: 'p9' });
    expect(getSpy).toHaveBeenCalledWith('p9');
  });

  it('deselectProduct removes a chip without hitting the service', () => {
    configure({ productIds: ['p1'] });
    expect(page.selectedProducts().map((p) => p.id)).toEqual(['p1']);
    page.deselectProduct('p1');
    expect(page.selectedProducts()).toHaveLength(0);
  });

  it('search forwards to listProducts with the debounced term', (done) => {
    configure();
    listSpy.mockClear();
    const evt = { target: { value: 'sneak' } } as unknown as Event;
    page.onSearch(evt);
    setTimeout(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: 'sneak', page: 1 }));
      done();
    }, 300);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
