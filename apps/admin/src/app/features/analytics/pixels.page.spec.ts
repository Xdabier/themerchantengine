import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AnalyticsPixelsPage } from './pixels.page';

expect.extend(toHaveNoViolations);

describe('AnalyticsPixelsPage', () => {
  let fixture: ComponentFixture<AnalyticsPixelsPage>;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function mount(initial = { googleAnalyticsId: 'G-ABC123' }) {
    getSpy = jest.fn().mockReturnValue(of(initial));
    updateSpy = jest.fn().mockReturnValue(of({ googleAnalyticsId: 'G-NEW1' }));
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsService, useValue: { getPixels: getSpy, updatePixels: updateSpy } },
      ],
    });
    fixture = TestBed.createComponent(AnalyticsPixelsPage);
    fixture.detectChanges();
  }

  it('hydrates the form from the current config', () => {
    mount();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector(
      '[data-testid="pixels-form-ga"] input',
    ) as HTMLInputElement | null;
    expect(input?.value).toBe('G-ABC123');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * QA finding C7 reported SAVE PIXELS as enabled on load. It does not
   * reproduce: the pristine gate was present at the QA build and is present
   * now, and the DOM button is genuinely disabled. The observation is
   * attributed to the C5 affordance defect, where a disabled control did not
   * look disabled. Pinned here so the real gate cannot regress unnoticed.
   * See specs/features/admin-qa-remediation/plan-c-dead-controls.md §2 C7.
   */
  it('keeps submit disabled while pristine', () => {
    mount();
    const root = fixture.nativeElement as HTMLElement;
    const btn = root.querySelector(
      '[data-testid="pixels-form-submit"] button',
    ) as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(true);
  });

  it('re-disables submit after a successful save re-hydrates the form', () => {
    mount();
    const page = fixture.componentInstance;
    const button = () =>
      fixture.nativeElement.querySelector(
        '[data-testid="pixels-form-submit"] button',
      ) as HTMLButtonElement;

    page.form.controls.googleAnalyticsId.setValue('G-NEW1');
    page.form.controls.googleAnalyticsId.markAsDirty();
    fixture.detectChanges();
    expect(button().disabled).toBe(false);

    page.submit();
    fixture.detectChanges();
    // `applyConfig` re-hydrates through form.reset, which marks it pristine.
    expect(page.form.pristine).toBe(true);
    expect(button().disabled).toBe(true);
  });

  it('marks invalid pattern and blocks submit', () => {
    mount();
    const page = fixture.componentInstance;
    page.form.controls.googleAnalyticsId.setValue('bad$char!');
    page.form.controls.googleAnalyticsId.markAsTouched();
    fixture.detectChanges();
    expect(page.form.invalid).toBe(true);
    expect(page.isInvalid('googleAnalyticsId')).toBe(true);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="pixels-form-submit"] button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('PATCHes a valid payload and surfaces the saved indicator', () => {
    mount();
    const page = fixture.componentInstance;
    page.form.controls.googleAnalyticsId.setValue('G-NEW1');
    page.form.controls.googleAnalyticsId.markAsDirty();
    fixture.detectChanges();
    page.submit();
    fixture.detectChanges();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ googleAnalyticsId: 'G-NEW1' }),
    );
    expect(page.saved()).toBe(true);
  });

  it('surfaces ApiForbiddenError from getPixels as a permission error', () => {
    getSpy = jest
      .fn()
      .mockReturnValue(
        throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
      );
    updateSpy = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsService, useValue: { getPixels: getSpy, updatePixels: updateSpy } },
      ],
    });
    fixture = TestBed.createComponent(AnalyticsPixelsPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toMatch(/permission/i);
  });

  it('surfaces ApiNotFoundError from getPixels with the dedicated copy', () => {
    getSpy = jest
      .fn()
      .mockReturnValue(
        throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
      );
    updateSpy = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsService, useValue: { getPixels: getSpy, updatePixels: updateSpy } },
      ],
    });
    fixture = TestBed.createComponent(AnalyticsPixelsPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toMatch(/not found/i);
  });

  it('is axe-clean after hydration', async () => {
    mount();
    const result = await axe(fixture.nativeElement);
    expect(result).toHaveNoViolations();
  });
});
