import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { sanitizeRichTextHtml } from './sanitize';

type ToolbarAction = 'bold' | 'italic' | 'h2' | 'h3' | 'ul' | 'ol' | 'link' | 'unlink' | 'clear';

interface ToolbarButton {
  action: ToolbarAction;
  label: string;
  aria: string;
}

/**
 * Minimal rich-text editor constrained to the same allow-list the backend
 * enforces (see `./sanitize.ts`).
 *
 * Why not TipTap — the brand allows only 10 formatting tags and our
 * bundle budget is already stretched. A sanitize-bounded contenteditable
 * with execCommand is ~0 KB of extra dependency and matches the
 * sanitize-html allow-list exactly. execCommand is deprecated-but-still-
 * supported in every modern browser; when that changes we swap in TipTap
 * behind this same CVA surface.
 *
 * Writes the sanitised HTML back through ControlValueAccessor on input
 * (debounced by the browser's DOM update) and on blur as a belt-and-
 * braces cleanup. The editable `<div>` carries `role="textbox"` +
 * `aria-multiline="true"` so screen readers announce it correctly.
 */
@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="flex flex-col gap-2" [attr.data-testid]="testId()">
      <div
        role="toolbar"
        [attr.aria-label]="ariaLabel() ?? 'Formatting toolbar'"
        class="flex flex-wrap items-center gap-1 border border-line border-b-0 px-2 py-1 bg-surface"
      >
        @for (btn of toolbar; track btn.action) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-2 py-1 border border-transparent hover:border-line focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:opacity-40"
            [disabled]="isDisabled()"
            [attr.aria-label]="btn.aria"
            [attr.data-testid]="testId() + '-' + btn.action"
            (click)="exec(btn.action)"
            (mousedown)="$event.preventDefault()"
          >
            {{ btn.label }}
          </button>
        }
      </div>

      <div
        #editable
        role="textbox"
        aria-multiline="true"
        [attr.id]="inputId() || null"
        [attr.aria-label]="ariaLabel() ?? 'Rich text'"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-describedby]="describedBy() || null"
        [attr.contenteditable]="isDisabled() ? 'false' : 'true'"
        [attr.data-placeholder]="placeholder() ?? ''"
        class="rich-text-editor-surface min-h-[160px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 empty:before:content-[attr(data-placeholder)] empty:before:text-ink-muted"
        [class.border-status-error]="invalid()"
        [attr.data-testid]="testId() + '-editable'"
        (input)="onInput()"
        (blur)="onBlur()"
      ></div>
    </div>
  `,
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit {
  readonly invalid = input<boolean>(false);
  readonly placeholder = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  readonly testId = input<string>('rich-text-editor');

  protected readonly isDisabled = signal<boolean>(false);
  private readonly editable = viewChild.required<ElementRef<HTMLElement>>('editable');
  private readonly doc = inject(DOCUMENT);

  private onChange: (v: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  readonly toolbar: readonly ToolbarButton[] = [
    { action: 'bold', label: 'B', aria: 'Bold' },
    { action: 'italic', label: 'I', aria: 'Italic' },
    { action: 'h2', label: 'H2', aria: 'Heading level 2' },
    { action: 'h3', label: 'H3', aria: 'Heading level 3' },
    { action: 'ul', label: '•', aria: 'Bulleted list' },
    { action: 'ol', label: '1.', aria: 'Numbered list' },
    { action: 'link', label: 'Link', aria: 'Insert link' },
    { action: 'unlink', label: 'Unlink', aria: 'Remove link' },
    { action: 'clear', label: 'Clear', aria: 'Clear formatting' },
  ];

  ngAfterViewInit(): void {
    // Without this, Enter emits a <div> line block, which the allowlist never
    // kept, so two authored lines merged into one run of text on save. The
    // `div -> p` transform in ./sanitize.ts covers pasted content and any
    // browser that ignores the hint.
    this.commandExec('defaultParagraphSeparator', 'p');
  }

  writeValue(value: string | null | undefined): void {
    const html = sanitizeRichTextHtml(value ?? '');
    const el = this.editable().nativeElement;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }

  onInput(): void {
    // Emit on every input without re-sanitizing the DOM (that would move
    // the caret). Sanitisation runs on read + on blur. The onChange value
    // is sanitized so consumers never see raw input.
    const raw = this.editable().nativeElement.innerHTML;
    this.onChange(sanitizeRichTextHtml(raw));
  }

  onBlur(): void {
    this.onTouched();
    // Clean up pasted junk once the user leaves the field.
    const el = this.editable().nativeElement;
    const clean = sanitizeRichTextHtml(el.innerHTML);
    if (el.innerHTML !== clean) el.innerHTML = clean;
    this.onChange(clean);
  }

  exec(action: ToolbarAction): void {
    if (this.isDisabled()) return;
    const el = this.editable().nativeElement;
    // Read the caret BEFORE focusing. The toolbar keeps focus on the editable
    // (mousedown is prevented), so focus() is a no-op in a browser, but it
    // collapses the selection into the host under jsdom.
    const enclosingList = this.enclosingListTag(el);
    el.focus();

    switch (action) {
      case 'bold':
      case 'italic':
        this.commandExec(action);
        break;
      case 'h2':
      case 'h3':
        // `formatBlock` with the caret in a list item wraps the WHOLE list, so
        // the value stored was `<h2><ul><li>..</li></ul></h2>`. Leave the list
        // first; the sanitizer's structural pass is the second net, not the
        // first.
        this.leaveList(enclosingList);
        this.commandExec('formatBlock', action.toUpperCase());
        break;
      case 'ul':
        this.commandExec('insertUnorderedList');
        break;
      case 'ol':
        this.commandExec('insertOrderedList');
        break;
      case 'link': {
        const current = this.currentLinkHref(el);
        const href = this.doc.defaultView?.prompt(
          'Link URL (https://, http://, or mailto:)',
          current ?? 'https://',
        );
        if (!href) return;
        if (this.isSafeScheme(href)) {
          this.commandExec('createLink', href);
        }
        break;
      }
      case 'unlink':
        this.commandExec('unlink');
        break;
      case 'clear':
        this.commandExec('removeFormat');
        break;
    }

    this.onInput();
  }

  private commandExec(command: string, value?: string): void {
    try {
      // `document.execCommand` is deprecated but universally still works;
      // replace with a Range-based implementation when it actually goes away.
      (
        this.doc as Document & { execCommand: (c: string, a?: boolean, v?: string) => boolean }
      ).execCommand(command, false, value);
    } catch {
      // Silent — any browser that drops execCommand support will trigger
      // the TipTap swap described in the class comment.
    }
  }

  private leaveList(list: 'ul' | 'ol' | null): void {
    if (!list) return;
    this.commandExec(list === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
  }

  /** The list the caret sits in, or null when it sits outside every list. */
  private enclosingListTag(el: HTMLElement): 'ul' | 'ol' | null {
    const sel = this.doc.defaultView?.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    let insideItem = false;
    while (node && node !== el) {
      if (node.nodeType === 1) {
        const tag = (node as HTMLElement).tagName;
        if (tag === 'LI') insideItem = true;
        if (insideItem && (tag === 'UL' || tag === 'OL')) return tag === 'OL' ? 'ol' : 'ul';
      }
      node = node.parentNode;
    }
    return null;
  }

  private currentLinkHref(el: HTMLElement): string | null {
    const sel = this.doc.defaultView?.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== el) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === 'A') {
        return (node as HTMLAnchorElement).getAttribute('href');
      }
      node = node.parentNode;
    }
    return null;
  }

  private isSafeScheme(href: string): boolean {
    return /^(https?:|mailto:)/i.test(href);
  }
}
