import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable, of, throwError } from 'rxjs';
import { axe, toHaveNoViolations } from 'jest-axe';
import { EntitySelectComponent } from './entity-select.component';
import type { EntityOption, EntitySelectPage, EntitySelectSource } from './entity-select.types';

expect.extend(toHaveNoViolations);

interface Row {
  id: string;
  name: string;
}

function option(id: string, label: string, sublabel?: string): EntityOption<Row> {
  return { id, label, ...(sublabel ? { sublabel } : {}), value: { id, name: label } };
}

class RecordingSource implements EntitySelectSource<Row> {
  readonly calls: Array<{ term: string; page: number }> = [];
  readonly resolved: string[][] = [];
  private readonly pages = new Map<number, EntitySelectPage<Row>>([
    [1, { options: [option('p1', 'Urban Shoe', 'SHOE-URB-42')], total: 3 }],
    [2, { options: [option('p2', 'Urban Cap', 'CAP-URB-01')], total: 3 }],
  ]);

  search(term: string, page: number): Observable<EntitySelectPage<Row>> {
    this.calls.push({ term, page });
    return of(this.pages.get(page) ?? { options: [], total: 0 });
  }

  resolve(ids: readonly string[]): Observable<EntityOption<Row>[]> {
    this.resolved.push([...ids]);
    return of([option(ids[0], 'Resolved Product')]);
  }
}

@Component({
  standalone: true,
  imports: [EntitySelectComponent, ReactiveFormsModule],
  template: `
    <app-entity-select
      id="picker"
      testId="picker"
      ariaLabel="Product"
      listboxLabel="Products"
      [source]="source()"
      [formControl]="control"
      (selectionChange)="lastSelection = $event"
    />
  `,
})
class HostComponent {
  readonly source = signal<EntitySelectSource<Row>>(new RecordingSource());
  readonly control = new FormControl<string>('', { nonNullable: true });
  lastSelection: EntityOption<Row> | null | undefined;
}

describe('EntitySelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let source: RecordingSource;

  beforeEach(async () => {
    jest.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    source = host.source() as RecordingSource;
  });

  afterEach(() => jest.useRealTimers());

  function start(): void {
    fixture.detectChanges();
  }
  /**
   * Queries the DOCUMENT, not the fixture: the option list renders through the
   * CDK overlay container, which is a sibling of the fixture root rather than a
   * descendant. That is the whole point of the overlay, since an `overflow`
   * ancestor clips an absolutely positioned popup.
   */
  function el<T extends HTMLElement>(selector: string): T {
    return document.querySelector(selector) as T;
  }
  function input(): HTMLInputElement {
    return el<HTMLInputElement>('[data-testid="picker"]');
  }
  function options(): HTMLElement[] {
    return Array.from(document.querySelectorAll('[data-entity-option]'));
  }
  function statusText(): string {
    return el('[data-testid="picker-status"]').textContent ?? '';
  }
  function focusInput(): HTMLInputElement {
    const node = input();
    node.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    return node;
  }
  function type(term: string): void {
    const node = input();
    node.value = term;
    node.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /**
   * The popup must not live inside the component's own subtree.
   *
   * An ancestor with `overflow: auto` clips absolutely positioned descendants,
   * and this control is used inside scrolling containers: the specifications
   * matrix wraps its table in `overflow-x-auto`, which silently cut the option
   * list in half. Rendering through a CDK connected overlay escapes every
   * clipping context rather than fighting each one.
   */
  it('renders the listbox in the overlay container, not inside the clipped host', () => {
    start();
    focusInput();
    const inHost = fixture.nativeElement.querySelector('[role="listbox"]');
    const inOverlay = document.querySelector('.cdk-overlay-container [role="listbox"]');
    expect(inHost).toBeNull();
    expect(inOverlay).not.toBeNull();
  });

  it('primes page 1 on init so the result count is never a surprise', () => {
    start();
    expect(source.calls).toEqual([{ term: '', page: 1 }]);
    expect(statusText()).toContain('Showing 1 of 3');
  });

  it('debounces typing and searches page 1 with the term', () => {
    start();
    focusInput();
    type('u');
    type('ur');
    type('urb');
    jest.advanceTimersByTime(199);
    expect(source.calls).toHaveLength(1);

    jest.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(source.calls[1]).toEqual({ term: 'urb', page: 1 });
  });

  it('says it is searching from the keystroke, not from the request', () => {
    // For the 200 ms debounce window the rows on screen and the count above
    // them describe the previous query, and the status used to read a
    // confident "Showing N of M" throughout. An operator who types and clicks
    // the top row hits the previous query's first result; two admin e2e
    // journeys did exactly that and were misdiagnosed as a search defect.
    start();
    focusInput();
    expect(statusText()).toContain('Showing 1 of 3');

    type('urb');
    expect(statusText()).toContain('Searching');
    expect(el('[role="listbox"]').getAttribute('aria-busy')).toBe('true');

    jest.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(statusText()).toContain('Showing');
    expect(el('[role="listbox"]').getAttribute('aria-busy')).toBeNull();
  });

  it('does not claim to be searching when the text returns to the committed term', () => {
    // distinctUntilChanged means retyping the same term fires no request, so a
    // status set unconditionally on input would never clear.
    start();
    focusInput();
    type('');
    expect(statusText()).toContain('Showing 1 of 3');
  });

  it('appends the next page when Load more is chosen and keeps the total honest', () => {
    start();
    focusInput();

    const loadMore = el<HTMLElement>('[data-testid="picker-load-more"]');
    expect(loadMore).toBeTruthy();
    loadMore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(source.calls[1]).toEqual({ term: '', page: 2 });
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('Urban Shoe'),
      expect.stringContaining('Urban Cap'),
    ]);
    expect(statusText()).toContain('Showing 2 of 3');
  });

  it('selects with the keyboard, writes the id to the control, and emits the option', () => {
    start();
    const node = focusInput();

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(node.getAttribute('aria-activedescendant')).toBe(options()[0].id);

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(host.control.value).toBe('p1');
    expect(host.lastSelection?.id).toBe('p1');
    expect(node.value).toBe('Urban Shoe');
    expect(node.getAttribute('aria-expanded')).toBe('false');
  });

  it('clears the committed selection when the operator edits the text again', () => {
    start();
    focusInput();
    options()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.control.value).toBe('p1');

    type('urban c');
    expect(host.control.value).toBe('');
    expect(host.lastSelection).toBeNull();
    jest.advanceTimersByTime(200);
  });

  it('resolves a pre-set control value into a label', () => {
    start();
    host.control.setValue('p9');
    fixture.detectChanges();

    expect(source.resolved).toEqual([['p9']]);
    expect(input().value).toBe('Resolved Product');
  });

  it('closes on Escape without changing the committed value', () => {
    start();
    const node = focusInput();
    expect(node.getAttribute('aria-expanded')).toBe('true');

    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(node.getAttribute('aria-expanded')).toBe('false');
    expect(host.control.value).toBe('');
  });

  it('surfaces a search failure instead of pretending the catalogue is empty', () => {
    host.source.set({ search: () => throwError(() => new Error('boom')) });
    start();
    expect(statusText()).toContain('Could not load');
  });

  it('has no axe violations with the list open', async () => {
    start();
    focusInput();
    // axe schedules its own work, so it needs the real clock back.
    jest.useRealTimers();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
  /**
   * The create affordance, and the two defects a second footer exposed.
   *
   * Before this, the roving index was `options().length - (canLoadMore ? 0 : 1)`,
   * which has room for exactly one footer, and Enter dispatched with
   * `options()[i] ? commit : loadMore`, so every index past the real options was
   * treated as load-more. A create footer added on top of that would have been
   * unreachable by ArrowDown and would have loaded more results on Enter.
   */
  it('offers no create row when the caller did not opt in', () => {
    start();
    focusInput();
    type('Something brand new');
    jest.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="picker-create"]')).toBeNull();
  });

  describe('allowCreate', () => {
    @Component({
      standalone: true,
      imports: [EntitySelectComponent, ReactiveFormsModule],
      template: `
        <app-entity-select
          id="picker"
          testId="picker"
          ariaLabel="Label"
          [allowCreate]="true"
          createOptionLabel="Add"
          [source]="source()"
          [formControl]="control"
          (selectionChange)="lastSelection = $event"
          (createRequested)="created.push($event)"
        />
      `,
    })
    class CreateHost {
      readonly source = signal<EntitySelectSource<Row>>(new RecordingSource());
      readonly control = new FormControl<string>('', { nonNullable: true });
      lastSelection: EntityOption<Row> | null | undefined;
      readonly created: string[] = [];
    }

    let f: ComponentFixture<CreateHost>;
    let h: CreateHost;

    function cInput(): HTMLInputElement {
      return f.nativeElement.querySelector('[data-testid="picker"]') as HTMLInputElement;
    }
    function cEl<T extends HTMLElement>(selector: string): T {
      return document.querySelector(selector) as T;
    }
    function cType(term: string): void {
      const node = cInput();
      node.value = term;
      node.dispatchEvent(new Event('input'));
      f.detectChanges();
      // `onInput` sets `loading` immediately, and both `canLoadMore` and the
      // status text read it. Let the debounce fire so assertions see a settled
      // component rather than 'Searching…'.
      jest.advanceTimersByTime(200);
      f.detectChanges();
    }
    function cKey(key: string): void {
      cInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      f.detectChanges();
    }
    function createRow(): HTMLElement | null {
      return document.querySelector('[data-testid="picker-create"]');
    }

    beforeEach(async () => {
      // The outer beforeEach already instantiated the TestBed for HostComponent,
      // and a module cannot be reconfigured once instantiated.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({ imports: [CreateHost] }).compileComponents();
      f = TestBed.createComponent(CreateHost);
      h = f.componentInstance;
      f.detectChanges();
      cInput().dispatchEvent(new Event('focus'));
      f.detectChanges();
    });

    it('offers the typed term when nothing loaded matches it', () => {
      cType('Autonomie');
      expect(createRow()).not.toBeNull();
      expect(createRow()!.textContent).toContain('Add');
      expect(createRow()!.textContent).toContain('Autonomie');
    });

    it('does not offer a term that an existing option already carries', () => {
      cType('urban shoe');
      jest.advanceTimersByTime(200);
      f.detectChanges();
      expect(createRow()).toBeNull();
    });

    it('does not offer an empty or whitespace-only term', () => {
      cType('   ');
      expect(createRow()).toBeNull();
    });

    /** Defect 1: the old lastIndex could not express a second footer. */
    it('ArrowDown walks options, then load-more, then reaches create', () => {
      cType('Autonomie');
      const active = () => cInput().getAttribute('aria-activedescendant');
      cKey('ArrowDown');
      const first = active();
      cKey('ArrowDown');
      const second = active();
      cKey('ArrowDown');
      const third = active();
      expect(new Set([first, second, third]).size).toBe(3);
      expect(third).toBe(createRow()!.id);
    });

    it('aria-activedescendant on the create row matches that row id exactly', () => {
      cType('Autonomie');
      cKey('ArrowDown');
      cKey('ArrowDown');
      cKey('ArrowDown');
      expect(cInput().getAttribute('aria-activedescendant')).toBe(createRow()!.id);
    });

    /** Defect 2: Enter past the real options used to fall through to loadMore. */
    it('Enter on the create row emits the term and does not load more', () => {
      cType('Autonomie');
      // Captured AFTER typing: the debounced search is expected. What must not
      // happen is a further page fetch from Enter falling through to load-more.
      const before = (h.source() as RecordingSource).calls.length;
      cKey('ArrowDown');
      cKey('ArrowDown');
      cKey('ArrowDown');
      cKey('Enter');
      expect(h.created).toEqual(['Autonomie']);
      expect((h.source() as RecordingSource).calls.length).toBe(before);
    });

    it('clicking the create row emits the term', () => {
      cType('Autonomie');
      createRow()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      f.detectChanges();
      expect(h.created).toEqual(['Autonomie']);
    });

    it('creating does not select a record or write to the form control', () => {
      cType('Autonomie');
      createRow()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      f.detectChanges();
      expect(h.lastSelection).toBeUndefined();
      expect(h.control.value).toBe('');
    });

    /**
     * Blur used to discard the typed term silently: onInput publishes nothing
     * outward, so tabbing to the next cell lost it with no warning.
     */
    it('blurring with an unmatched term still emits it rather than losing it', () => {
      cType('Autonomie');
      cInput().dispatchEvent(new Event('blur'));
      f.detectChanges();
      expect(h.created).toEqual(['Autonomie']);
    });

    it('announces the create affordance in the status region', () => {
      cType('Autonomie');
      const status = cEl('[data-testid="picker-status"]');
      expect(status.textContent).toContain('Add');
      expect(status.textContent).toContain('Autonomie');
    });

    it('has no axe violations with the create row open', async () => {
      cType('Autonomie');
      // axe schedules real async work, which never resolves under fake timers.
      jest.useRealTimers();
      // Scans the overlay too, since that is where the listbox lives. `region`
      // is disabled because a bare test page has no landmarks to contain its
      // content; that is a property of the harness, not of this control.
      expect(
        await axe(document.body, { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations();
    });
  });
});
