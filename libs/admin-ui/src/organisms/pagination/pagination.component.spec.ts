import { TestBed } from '@angular/core/testing';
import { PaginationComponent } from './pagination.component';

describe('PaginationComponent', () => {
  function mount(inputs: { page: number; pageSize: number; total: number; loading?: boolean }) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PaginationComponent] });
    const fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('testIdPrefix', 'orders');
    fixture.componentRef.setInput('page', inputs.page);
    fixture.componentRef.setInput('pageSize', inputs.pageSize);
    fixture.componentRef.setInput('total', inputs.total);
    fixture.componentRef.setInput('loading', inputs.loading ?? false);
    fixture.detectChanges();
    return fixture;
  }

  it('hides the nav when everything fits on one page', () => {
    const fixture = mount({ page: 1, pageSize: 20, total: 4 });
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="orders-meta"]').textContent,
    ).toContain('Showing 1–4 of 4');
  });

  it('hides the nav and the range on an empty list', () => {
    const fixture = mount({ page: 1, pageSize: 20, total: 0 });
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="orders-meta"]').textContent,
    ).not.toContain('Showing');
  });

  it('renders the nav once there is a second page', () => {
    const fixture = mount({ page: 1, pageSize: 20, total: 21 });
    expect(fixture.nativeElement.querySelector('nav')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="orders-prev"] button')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="orders-next"] button')).toBeTruthy();
  });

  it('shows Prev/Next visibly and the long form to assistive tech', () => {
    const fixture = mount({ page: 1, pageSize: 20, total: 60 });
    const prev = fixture.nativeElement.querySelector(
      '[data-testid="orders-prev"] button',
    ) as HTMLButtonElement;
    const next = fixture.nativeElement.querySelector(
      '[data-testid="orders-next"] button',
    ) as HTMLButtonElement;
    expect(prev.textContent?.trim()).toBe('Prev');
    expect(next.textContent?.trim()).toBe('Next');
    expect(prev.getAttribute('aria-label')).toBe('Previous page');
    expect(next.getAttribute('aria-label')).toBe('Next page');
  });

  it('disables Prev on the first page and Next on the last', () => {
    const first = mount({ page: 1, pageSize: 20, total: 60 });
    expect(
      (first.nativeElement.querySelector('[data-testid="orders-prev"] button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (first.nativeElement.querySelector('[data-testid="orders-next"] button') as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    const last = mount({ page: 3, pageSize: 20, total: 60 });
    expect(
      (last.nativeElement.querySelector('[data-testid="orders-next"] button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('disables both controls while a page is loading', () => {
    const fixture = mount({ page: 2, pageSize: 20, total: 60, loading: true });
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="orders-prev"] button',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-testid="orders-next"] button',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('emits the requested page number', () => {
    const fixture = mount({ page: 2, pageSize: 20, total: 60 });
    const seen: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => seen.push(p));
    (
      fixture.nativeElement.querySelector('[data-testid="orders-prev"] button') as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector('[data-testid="orders-next"] button') as HTMLButtonElement
    ).click();
    expect(seen).toEqual([1, 3]);
  });

  it('applies the module testid prefix', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PaginationComponent] });
    const fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('testIdPrefix', 'campaigns');
    fixture.componentRef.setInput('page', 1);
    fixture.componentRef.setInput('pageSize', 20);
    fixture.componentRef.setInput('total', 40);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="campaigns-next"] button'),
    ).toBeTruthy();
  });
});
