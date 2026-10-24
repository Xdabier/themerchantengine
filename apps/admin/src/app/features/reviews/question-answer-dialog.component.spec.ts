import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QuestionAnswerDialogComponent } from './question-answer-dialog.component';

expect.extend(toHaveNoViolations);

describe('QuestionAnswerDialogComponent', () => {
  let fixture: ComponentFixture<QuestionAnswerDialogComponent>;
  let component: QuestionAnswerDialogComponent;
  let close: jest.Mock;

  function configure(data: { existing?: string | null; status?: string } = {}) {
    close = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(QuestionAnswerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const answerTextarea = () =>
    fixture.nativeElement.querySelector(
      '[data-testid="answer-body"] textarea',
    ) as HTMLTextAreaElement;

  it('advances the character counter live as the answer is typed', () => {
    configure();
    expect(component.counter()).toBe('0 / 5000');

    const el = answerTextarea();
    el.value = 'Within 30 days.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(component.counter()).toBe('15 / 5000');
  });

  it('surfaces then clears the answer error live as the field is edited', () => {
    configure();
    const el = answerTextarea();

    el.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(component.answerError()).toBe('Answer is required.');

    el.value = 'A valid answer.';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(component.answerError()).toBeNull();
  });

  it('isAdminAnswer defaults to true', () => {
    configure();
    expect(component.form.controls.isAdminAnswer.value).toBe(true);
  });

  it('submit is blocked while answer is empty', () => {
    configure();
    expect(component.form.valid).toBe(false);
    component.submit();
    expect(close).not.toHaveBeenCalled();
  });

  it('submit is blocked when answer exceeds 5000 chars', () => {
    configure();
    component.form.controls.answer.setValue('x'.repeat(5001));
    expect(component.form.valid).toBe(false);
  });

  it('submit forwards trimmed answer + isAdminAnswer=true by default', () => {
    configure();
    component.form.controls.answer.setValue('  Within 30 days.  ');
    component.submit();
    expect(close).toHaveBeenCalledWith({
      answer: 'Within 30 days.',
      isAdminAnswer: true,
      publish: false,
    });
  });

  it('offers publish-on-answer, default on, for a question awaiting moderation', () => {
    // Answering left the question PENDING with no prompt to approve, so an
    // operator who answered and moved on had an invisible answered question.
    configure({ status: 'PENDING' });
    expect(
      fixture.nativeElement.querySelector('[data-testid="answer-publish-toggle"]'),
    ).not.toBeNull();
    expect(component.form.controls.publish.value).toBe(true);

    component.form.controls.answer.setValue('Within 30 days.');
    component.submit();
    expect(close).toHaveBeenCalledWith({
      answer: 'Within 30 days.',
      isAdminAnswer: true,
      publish: true,
    });
  });

  it('forwards publish=false when the operator clears the toggle', () => {
    configure({ status: 'PENDING' });
    component.form.controls.answer.setValue('Draft reply.');
    component.form.controls.publish.setValue(false);
    component.submit();
    expect(close).toHaveBeenCalledWith({
      answer: 'Draft reply.',
      isAdminAnswer: true,
      publish: false,
    });
  });

  it('offers no publish toggle on a question that is already published', () => {
    configure({ status: 'PUBLISHED' });
    expect(fixture.nativeElement.querySelector('[data-testid="answer-publish-toggle"]')).toBeNull();

    component.form.controls.answer.setValue('Corrected reply.');
    component.submit();
    expect(close).toHaveBeenCalledWith({
      answer: 'Corrected reply.',
      isAdminAnswer: true,
      publish: false,
    });
  });

  it('submit forwards isAdminAnswer=false when the checkbox is cleared', () => {
    configure();
    component.form.controls.answer.setValue('Partner reply.');
    component.form.controls.isAdminAnswer.setValue(false);
    component.submit();
    expect(close).toHaveBeenCalledWith({
      answer: 'Partner reply.',
      isAdminAnswer: false,
      publish: false,
    });
  });

  it('seeds the form with an existing answer when provided', () => {
    configure({ existing: 'Previous text.' });
    expect(component.form.controls.answer.value).toBe('Previous text.');
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
