import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ReviewModerateDialogComponent } from './review-moderate-dialog.component';

expect.extend(toHaveNoViolations);

describe('ReviewModerateDialogComponent', () => {
  let fixture: ComponentFixture<ReviewModerateDialogComponent>;
  let component: ReviewModerateDialogComponent;
  let close: jest.Mock;

  function configure(subject: 'review' | 'question' = 'review') {
    close = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: { subject } },
      ],
    });
    fixture = TestBed.createComponent(ReviewModerateDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** Drive the reason through the real CVA path (textarea input event). */
  function typeReason(value: string): void {
    const el = fixture.nativeElement.querySelector(
      '[data-testid="moderate-reason"] textarea',
    ) as HTMLTextAreaElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('advances the character counter live as the reason is typed', () => {
    configure();
    const hint = () =>
      (
        fixture.nativeElement.querySelector('p[id$="-hint"]') as HTMLElement | null
      )?.textContent?.trim();
    expect(component.counter()).toBe('0 / 1000');
    expect(hint()).toBe('0 / 1000');

    typeReason('Off-topic');
    fixture.detectChanges();

    expect(component.counter()).toBe('9 / 1000');
    expect(hint()).toBe('9 / 1000');
  });

  it('renders the review title by default', () => {
    configure('review');
    expect(component.title()).toBe('Reject this review');
    expect(component.submitLabel()).toBe('Reject review');
  });

  it('adapts title + submit label for a question subject', () => {
    configure('question');
    expect(component.title()).toBe('Reject this question');
    expect(component.submitLabel()).toBe('Reject question');
  });

  it('submit is enabled with empty reason (reason is optional)', () => {
    configure();
    expect(component.form.valid).toBe(true);
  });

  it('submit closes with an empty reason payload when textarea is blank', () => {
    configure();
    component.submit();
    expect(close).toHaveBeenCalledWith({});
  });

  it('submit trims and forwards the reason', () => {
    configure();
    component.form.controls.reason.setValue('  Off-topic  ');
    component.submit();
    expect(close).toHaveBeenCalledWith({ reason: 'Off-topic' });
  });

  it('marks the form invalid when reason exceeds 1000 chars', () => {
    configure();
    component.form.controls.reason.setValue('x'.repeat(1001));
    expect(component.form.valid).toBe(false);
    expect(component.form.controls.reason.hasError('maxlength')).toBe(true);
  });

  it('cancel forwards null to the parent', () => {
    configure();
    component.close(null);
    expect(close).toHaveBeenCalledWith(null);
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
