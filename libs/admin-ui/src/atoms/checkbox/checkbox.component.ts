import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'app-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label
      class="inline-flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer"
      [class.cursor-not-allowed]="disabled"
      [class.opacity-50]="disabled"
    >
      <input
        #native
        type="checkbox"
        class="appearance-none w-5 h-5 border border-line-strong bg-surface checked:bg-surface-emphasis checked:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:cursor-not-allowed relative after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-on-emphasis after:text-sm after:font-bold checked:after:content-['✓'] indeterminate:after:content-['–'] indeterminate:bg-surface-emphasis indeterminate:border-ink"
        [attr.aria-label]="ariaLabel"
        [attr.id]="id"
        [checked]="checked"
        [disabled]="disabled"
        (change)="onNativeChange($event)"
      />
    </label>
  `,
})
export class CheckboxComponent implements OnChanges, AfterViewInit {
  @Input() checked = false;
  @Input() indeterminate = false;
  @Input() disabled = false;
  @Input() ariaLabel: string | null = null;
  @Input() id: string | null = null;
  @Output() readonly changed = new EventEmitter<boolean>();

  @ViewChild('native', { static: false }) private native?: ElementRef<HTMLInputElement>;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['indeterminate']) this.syncIndeterminate();
  }

  ngAfterViewInit(): void {
    this.syncIndeterminate();
  }

  private syncIndeterminate(): void {
    const el = this.native?.nativeElement;
    if (el) el.indeterminate = this.indeterminate;
  }

  protected onNativeChange(event: Event): void {
    const next = (event.target as HTMLInputElement).checked;
    this.changed.emit(next);
  }
}
