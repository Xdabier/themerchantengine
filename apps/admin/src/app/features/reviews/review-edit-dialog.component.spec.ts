import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import {
  ReviewEditDialogComponent,
  type ReviewEditDialogData,
  type ReviewEditDialogResult,
} from './review-edit-dialog.component';

expect.extend(toHaveNoViolations);

const baseData: ReviewEditDialogData = {
  reviewId: 'review-1',
  rating: 4,
  title: 'Nice fit',
  body: 'Comfortable and stylish.',
  status: 'PENDING',
};

describe('ReviewEditDialogComponent', () => {
  let fixture: ComponentFixture<ReviewEditDialogComponent>;
  let component: ReviewEditDialogComponent;
  let close: jest.Mock<unknown, [ReviewEditDialogResult | null]>;

  function configure(data: ReviewEditDialogData = baseData) {
    close = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(ReviewEditDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('keeps the body counter + error live after the body changes (zoneless reactivity)', () => {
    configure();
    // Regression guard for the memoized-computed bug: derived view-state must be
    // re-read AFTER a change, not just on the pristine form. With a computed()
    // over Reactive-Forms getters these freeze at their initial value.
    component.form.controls.body.setValue('Short');
    component.form.controls.body.markAsDirty();
    fixture.detectChanges();
    expect(component.bodyCounter()).toBe('5 / 5000');

    component.form.controls.body.setValue('');
    component.form.controls.body.markAsDirty();
    fixture.detectChanges();
    expect(component.bodyError()).toBe('Body is required.');
  });

  it('hydrates the form with the supplied review payload', () => {
    configure();
    expect(component.form.value).toMatchObject({
      rating: 4,
      title: 'Nice fit',
      body: 'Comfortable and stylish.',
      status: 'PENDING',
      reason: '',
    });
    expect(component.form.pristine).toBe(true);
  });

  it('submit is a no-op when the form is pristine', () => {
    configure();
    component.submit();
    expect(close).not.toHaveBeenCalled();
  });

  it('submit closes with the trimmed payload and omits empty reason', () => {
    configure();
    component.form.patchValue({
      body: 'Edited body — clearer wording.',
      status: 'PUBLISHED',
    });
    component.form.markAsDirty();
    component.submit();
    expect(close).toHaveBeenCalledWith({
      rating: 4,
      title: 'Nice fit',
      body: 'Edited body — clearer wording.',
      status: 'PUBLISHED',
    });
  });

  it('submit forwards a trimmed reason when present', () => {
    configure();
    component.form.patchValue({
      body: 'Light edit',
      reason: '  light copy edit  ',
    });
    component.form.markAsDirty();
    component.submit();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ reason: 'light copy edit' }));
  });

  it('submit nulls the title when it trims to an empty string', () => {
    configure({ ...baseData, title: 'Original' });
    component.form.patchValue({ title: '   ', body: 'still good' });
    component.form.markAsDirty();
    component.submit();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ title: null }));
  });

  it('marks the form invalid for an out-of-range rating', () => {
    configure();
    component.form.controls.rating.setValue(99);
    expect(component.form.controls.rating.hasError('max')).toBe(true);
    expect(component.form.invalid).toBe(true);
  });

  it('marks the form invalid for an empty body', () => {
    configure();
    component.form.controls.body.setValue('');
    expect(component.form.controls.body.hasError('required')).toBe(true);
    expect(component.form.invalid).toBe(true);
  });

  it('cancel closes the dialog with null', () => {
    configure();
    component.cancel();
    expect(close).toHaveBeenCalledWith(null);
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
