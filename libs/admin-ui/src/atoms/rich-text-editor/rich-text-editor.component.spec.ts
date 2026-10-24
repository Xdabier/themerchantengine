import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { RichTextEditorComponent } from './rich-text-editor.component';

expect.extend(toHaveNoViolations);

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RichTextEditorComponent],
  template: `<app-rich-text-editor [formControl]="control" ariaLabel="Description" />`,
})
class Host {
  readonly control = new FormControl<string>('', { nonNullable: true });
}

describe('RichTextEditorComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function editable(): HTMLElement {
    return fixture.nativeElement.querySelector(
      '[data-testid=rich-text-editor-editable]',
    ) as HTMLElement;
  }

  it('renders the toolbar with every action', () => {
    const actions = ['bold', 'italic', 'h2', 'h3', 'ul', 'ol', 'link', 'unlink', 'clear'];
    for (const action of actions) {
      expect(
        fixture.nativeElement.querySelector(`[data-testid=rich-text-editor-${action}]`),
      ).not.toBeNull();
    }
  });

  it('writes initial value through ControlValueAccessor (sanitized)', () => {
    host.control.setValue('<p>Hi</p><script>alert(1)</script>');
    fixture.detectChanges();
    expect(editable().innerHTML).toBe('<p>Hi</p>');
  });

  it('emits sanitized HTML on input events', () => {
    editable().innerHTML = '<p>Ok <script>bad()</script></p>';
    editable().dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.control.value).toBe('<p>Ok </p>');
  });

  it('blur re-sanitises the visible DOM as belt-and-braces', () => {
    editable().innerHTML = '<p>Hello</p><img src="x">';
    editable().dispatchEvent(new Event('blur', { bubbles: true }));
    expect(editable().innerHTML).toBe('<p>Hello</p>');
  });

  it('has no axe violations', async () => {
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});

describe('RichTextEditorComponent command sequence', () => {
  type ExecCall = [string, boolean | undefined, string | undefined];

  let calls: ExecCall[];
  let fixture: ComponentFixture<Host>;
  let original: unknown;

  beforeEach(() => {
    calls = [];
    const doc = document as unknown as Record<string, unknown>;
    original = doc['execCommand'];
    doc['execCommand'] = (c: string, a?: boolean, v?: string) => {
      calls.push([c, a, v]);
      return true;
    };
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    (document as unknown as Record<string, unknown>)['execCommand'] = original;
  });

  function editable(): HTMLElement {
    return fixture.nativeElement.querySelector(
      '[data-testid=rich-text-editor-editable]',
    ) as HTMLElement;
  }

  function click(action: string): void {
    (
      fixture.nativeElement.querySelector(`[data-testid=rich-text-editor-${action}]`) as HTMLElement
    ).click();
  }

  function caretIn(selector: string): void {
    const target = editable().querySelector(selector) as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('asks the browser for paragraph line blocks on init', () => {
    // Without this Enter emits <div>, which the allowlist never kept, so two
    // authored lines merged into one on save.
    expect(calls).toContainEqual(['defaultParagraphSeparator', false, 'p']);
  });

  it('leaves a bulleted list before turning the line into a heading', () => {
    editable().innerHTML = '<ul><li>x</li></ul>';
    caretIn('li');
    calls.length = 0;
    click('h2');
    expect(calls.map((c) => c[0])).toEqual(['insertUnorderedList', 'formatBlock']);
  });

  it('leaves a numbered list before turning the line into a heading', () => {
    editable().innerHTML = '<ol><li>x</li></ol>';
    caretIn('li');
    calls.length = 0;
    click('h3');
    expect(calls.map((c) => c[0])).toEqual(['insertOrderedList', 'formatBlock']);
  });

  it('does not toggle a list when the caret is not inside one', () => {
    editable().innerHTML = '<p>x</p>';
    caretIn('p');
    calls.length = 0;
    click('h2');
    expect(calls.map((c) => c[0])).toEqual(['formatBlock']);
  });
});
