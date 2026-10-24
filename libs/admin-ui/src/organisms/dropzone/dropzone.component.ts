import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

export interface DropzoneFileRejection {
  file: File;
  reason: 'mime' | 'size';
}

/**
 * Accessible drag-drop uploader.
 *
 * Client-side gates:
 * - `accept` — comma-separated MIME list; defaults to images + video as
 *   per `specs/admin-dashboard/clarifications.md` Q5.
 * - `maxSizeBytes` — rejects before emission, caller never sees an
 *   oversized File.
 * - `multiple` — gate native file input + accept multi-item dataTransfer.
 *
 * Keyboard — the drop surface is a `<button>` so Enter/Space open the
 * native file picker. The hidden `<input type="file">` is the actual
 * form target; focus stays on the button after selection.
 *
 * Emits:
 * - `filesAdded(File[])` — the accepted batch (MIME + size OK).
 * - `filesRejected(DropzoneFileRejection[])` — caller surfaces an error.
 */
@Component({
  selector: 'app-dropzone',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-3"
      [attr.data-testid]="testId()"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-3 border border-dashed w-full min-h-[160px] px-6 py-8 bg-surface text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 motion-safe:transition-colors motion-safe:duration-75"
        [class.border-ink]="dragOver()"
        [class.border-line]="!dragOver()"
        [class.bg-surface-elevated]="dragOver()"
        [disabled]="disabled() || busy()"
        [attr.aria-label]="buttonLabel()"
        (click)="openPicker()"
        (keydown.enter)="openPicker()"
        (keydown.space)="$event.preventDefault(); openPicker()"
        (dragenter)="onDragEnter($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        data-testid="dropzone-trigger"
      >
        <span class="text-xs tracking-widest uppercase text-ink-muted">
          {{ busy() ? 'Uploading…' : primaryLabel() }}
        </span>
        <span class="tabular text-xs text-ink-muted max-w-sm text-center">
          {{ hint() ?? defaultHint() }}
        </span>
      </button>

      <input
        #picker
        type="file"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        [attr.aria-label]="primaryLabel()"
        [attr.accept]="accept()"
        [multiple]="multiple()"
        (change)="onPicked($event)"
        data-testid="dropzone-input"
      />
    </div>
  `,
})
export class DropzoneComponent {
  /** Comma-separated MIME allow-list, e.g. "image/jpeg,image/png". */
  readonly accept = input<string>(
    'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm',
  );
  readonly maxSizeBytes = input<number>(10 * 1024 * 1024);
  readonly multiple = input<boolean>(true);
  readonly disabled = input<boolean>(false);
  readonly busy = input<boolean>(false);
  readonly primaryLabel = input<string>('Drop files here or click to browse');
  readonly hint = input<string | null>(null);
  readonly testId = input<string>('dropzone');

  readonly filesAdded = output<File[]>();
  readonly filesRejected = output<DropzoneFileRejection[]>();

  readonly dragOver = signal(false);
  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private readonly root = inject(ElementRef<HTMLElement>);

  readonly buttonLabel = computed(
    () =>
      `${this.primaryLabel()}. Max ${Math.round(this.maxSizeBytes() / (1024 * 1024))} megabytes per file.`,
  );

  readonly defaultHint = computed(() => {
    const allowed = this.accept()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((mime) => mime.replace(/^[^/]+\//, ''))
      .join(' · ');
    const maxMb = Math.round(this.maxSizeBytes() / (1024 * 1024));
    return `Up to ${maxMb} MB each · ${allowed || 'any'}`;
  });

  @HostListener('window:dragover', ['$event'])
  blockWindowDragover(event: DragEvent): void {
    // Prevent the browser opening dropped files in a new tab when the user
    // misses the dropzone target.
    event.preventDefault();
  }

  openPicker(): void {
    if (this.disabled() || this.busy()) return;
    this.picker().nativeElement.click();
  }

  onPicked(event: Event): void {
    const list = (event.target as HTMLInputElement).files;
    this.emitFiles(list);
    // Reset so picking the same file twice still fires change.
    (event.target as HTMLInputElement).value = '';
  }

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.disabled() || this.busy()) return;
    if (event.dataTransfer?.types?.includes('Files')) this.dragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only clear the hover state when the cursor actually leaves the root;
    // child elements fire dragleave during traversal.
    if (!this.root.nativeElement.contains(event.relatedTarget as Node | null)) {
      this.dragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
    if (this.disabled() || this.busy()) return;
    this.emitFiles(event.dataTransfer?.files ?? null);
  }

  private emitFiles(list: FileList | null): void {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const allow = this.accept()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const accepted: File[] = [];
    const rejected: DropzoneFileRejection[] = [];

    for (const file of files) {
      if (!this.mimeAllowed(file.type, allow)) {
        rejected.push({ file, reason: 'mime' });
        continue;
      }
      if (file.size > this.maxSizeBytes()) {
        rejected.push({ file, reason: 'size' });
        continue;
      }
      accepted.push(file);
      if (!this.multiple()) break;
    }

    if (!this.multiple() && accepted.length > 1) accepted.length = 1;
    if (rejected.length > 0) this.filesRejected.emit(rejected);
    if (accepted.length > 0) this.filesAdded.emit(accepted);
  }

  /**
   * True when the file's MIME is in the allow-list. Supports `image/*`
   * style wildcards even though the backend doesn't.
   */
  private mimeAllowed(mime: string, allow: readonly string[]): boolean {
    if (allow.length === 0) return true;
    return allow.some((pattern) => {
      if (pattern === mime) return true;
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        return mime.startsWith(prefix);
      }
      return false;
    });
  }
}
