import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { categoryShowcaseConfigSchema } from '@admin-services';
import { buildCategoryShowcaseForm, type CategoryShowcaseForm } from './build-config-forms';
import { CategoryShowcaseSectionEditorComponent } from './category-showcase-section-editor.component';

expect.extend(toHaveNoViolations);

const CAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

@Component({
  standalone: true,
  imports: [CategoryShowcaseSectionEditorComponent],
  template: '<app-category-showcase-section-editor [form]="form()" />',
})
class HostComponent {
  readonly form = signal<CategoryShowcaseForm>(buildCategoryShowcaseForm(new FormBuilder()));
}

describe('CategoryShowcaseSectionEditorComponent', () => {
  let host: HostComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts invalid (the seeded categoryIds row is empty)', () => {
    expect(host.form().invalid).toBe(true);
  });

  it('becomes valid when at least one valid UUID is supplied', () => {
    const form = host.form();
    form.controls.categoryIds.at(0).setValue(CAT_A);
    form.markAsDirty();

    expect(form.valid).toBe(true);
  });

  it('round-trips through the matching Zod schema', () => {
    const form = host.form();
    form.controls.categoryIds.at(0).setValue(CAT_A);
    form.controls.categoryIds.push(new FormBuilder().nonNullable.control(CAT_B));

    const raw = form.getRawValue();
    expect(() =>
      categoryShowcaseConfigSchema.parse({ categoryIds: raw.categoryIds }),
    ).not.toThrow();
  });

  it('renders without axe-detectable violations', async () => {
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
