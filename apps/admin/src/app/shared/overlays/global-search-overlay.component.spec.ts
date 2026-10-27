import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GlobalSearchService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import {
  GlobalSearchOverlayComponent,
  type GlobalSearchOverlayData,
  type GlobalSearchOverlayResult,
} from './global-search-overlay.component';

expect.extend(toHaveNoViolations);

const navItems = [
  { label: 'Orders', to: '/orders' },
  { label: 'Products', to: '/products' },
  { label: 'Customers', to: '/customers' },
];

const fixtureGroups = {
  query: 'sneak',
  groups: [
    {
      type: 'product' as const,
      total: 1,
      items: [{ id: 'p1', title: 'Sneaker', subtitle: '/sneaker', url: '/products/p1' }],
    },
  ],
};

describe('GlobalSearchOverlayComponent', () => {
  let fixture: ComponentFixture<GlobalSearchOverlayComponent>;
  let component: GlobalSearchOverlayComponent;
  let searchSpy: jest.Mock;
  let closeSpy: jest.Mock;

  function configure(data: GlobalSearchOverlayData = { navItems }) {
    closeSpy = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: GlobalSearchService, useValue: { search: searchSpy } },
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(GlobalSearchOverlayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    searchSpy = jest.fn(() => of(fixtureGroups));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the full nav list when query is empty', () => {
    configure();
    // All three nav items appear as flat rows.
    expect(component['flat']().filter((r) => r.type === 'nav').length).toBe(3);
  });

  it('filters nav items by substring when query is typed', () => {
    configure();
    component['onQueryChange']('Or');
    expect(
      component['flat']()
        .filter((r) => r.type === 'nav')
        .map((r) => r.label),
    ).toEqual(['Orders']);
  });

  it('calls the search service after debounce once query >= minChars', () => {
    configure();
    component['onQueryChange']('sn');
    jest.advanceTimersByTime(250);
    expect(searchSpy).toHaveBeenCalledWith({ q: 'sn', limit: 5 });
  });

  it('merges backend hits into the flat list', () => {
    configure();
    component['onQueryChange']('sneak');
    jest.advanceTimersByTime(250);
    const flat = component['flat']();
    expect(flat.some((r) => r.type === 'product')).toBe(true);
    expect(flat.some((r) => r.type === 'see-all')).toBe(true);
  });

  it('commit closes the dialog with the active row', () => {
    configure();
    component['onQueryChange']('ord');
    jest.advanceTimersByTime(250);
    component['activeIndex'].set(0);
    component['commit'](new Event('keydown'));
    expect(closeSpy).toHaveBeenCalled();
    const arg = closeSpy.mock.calls[0][0] as GlobalSearchOverlayResult;
    expect(arg.kind).toBe('nav');
  });

  it('surfaces an error string when the API fails', () => {
    searchSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    component['onQueryChange']('sneak');
    jest.advanceTimersByTime(250);
    expect(component['error']()).toContain('Search failed');
  });

  it('has no axe violations', async () => {
    jest.useRealTimers();
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
