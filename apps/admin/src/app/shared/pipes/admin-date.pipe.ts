import { Pipe, PipeTransform, inject } from '@angular/core';
import { formatAdminDate, formatAdminDateTime, formatAdminForensic } from '../format/datetime';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/** The three documented timestamp contexts (plan E, D6). */
export type AdminDateFormat = 'datetime' | 'date' | 'forensic';

/**
 * Render an instant in the store timezone, in one of three documented formats.
 *
 *  - `{{ row.createdAt | adminDate }}` → `24 May 2026, 14:15` (default).
 *  - `{{ page.publishedAt | adminDate: 'date' }}` → `24 May 2026`.
 *  - `{{ entry.createdAt | adminDate: 'forensic' }}` → `24 May 2026, 03:32:42 GMT+3`.
 *
 * Replaces fifteen private `formatDate` helpers plus four hardcoded `DatePipe`
 * formats, all of which rendered in the *browser's* timezone and locale.
 *
 * Impure for the same reason as `MoneyPipe`: `StoreSettingsStore` hydrates one
 * request after first paint, and every visible timestamp has to re-render when
 * it lands. Memoized on `(value, format, timezone)`, so steady-state cost is a
 * reference comparison per cell.
 */
@Pipe({ name: 'adminDate', standalone: true, pure: false })
export class AdminDatePipe implements PipeTransform {
  private readonly settings = inject(StoreSettingsStore);

  private lastValue: string | Date | null | undefined;
  private lastFormat: AdminDateFormat = 'datetime';
  private lastTimeZone = '';
  private lastResult = '';
  private primed = false;

  transform(value: string | Date | null | undefined, format: AdminDateFormat = 'datetime'): string {
    const timeZone = this.settings.timezone();
    if (
      this.primed &&
      value === this.lastValue &&
      format === this.lastFormat &&
      timeZone === this.lastTimeZone
    ) {
      return this.lastResult;
    }

    this.lastValue = value;
    this.lastFormat = format;
    this.lastTimeZone = timeZone;
    this.lastResult =
      format === 'date'
        ? formatAdminDate(value, timeZone)
        : format === 'forensic'
          ? formatAdminForensic(value, timeZone)
          : formatAdminDateTime(value, timeZone);
    this.primed = true;
    return this.lastResult;
  }
}
