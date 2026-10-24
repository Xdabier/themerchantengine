import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { FormFieldComponent, InputComponent } from '@admin-ui';
import { FormsModule } from '@angular/forms';

export interface DateRangeValue {
  readonly from?: string;
  readonly to?: string;
}

/** Shared date-range picker for analytics sub-reports. Emits ISO-8601 strings. */
@Component({
  selector: 'app-analytics-date-range',
  standalone: true,
  imports: [FormsModule, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg"
      data-testid="analytics-date-range"
      role="group"
      aria-label="Date range"
    >
      <app-form-field label="From" fieldId="analytics-range-from">
        <app-input
          id="analytics-range-from"
          type="date"
          [ngModel]="from()"
          (ngModelChange)="onFromChange($event)"
          data-testid="analytics-range-from-input"
        />
      </app-form-field>
      <app-form-field label="To" fieldId="analytics-range-to">
        <app-input
          id="analytics-range-to"
          type="date"
          [ngModel]="to()"
          (ngModelChange)="onToChange($event)"
          data-testid="analytics-range-to-input"
        />
      </app-form-field>
    </div>
  `,
})
export class AnalyticsDateRangeComponent {
  readonly from = signal<string>('');
  readonly to = signal<string>('');
  readonly rangeChanged = output<DateRangeValue>();

  protected onFromChange(value: string): void {
    this.from.set(value);
    this.emit();
  }

  protected onToChange(value: string): void {
    this.to.set(value);
    this.emit();
  }

  private emit(): void {
    this.rangeChanged.emit({
      from: this.from() ? new Date(`${this.from()}T00:00:00Z`).toISOString() : undefined,
      to: this.to() ? new Date(`${this.to()}T23:59:59Z`).toISOString() : undefined,
    });
  }
}
