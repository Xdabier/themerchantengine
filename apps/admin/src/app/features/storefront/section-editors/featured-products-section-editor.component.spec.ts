import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { featuredProductsConfigSchema } from '@admin-services';
import { buildFeaturedProductsForm, type FeaturedProductsForm } from './build-config-forms';
import { FeaturedProductsSectionEditorComponent } from './featured-products-section-editor.component';

expect.extend(toHaveNoViolations);

const PROD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

@Component({
  standalone: true,
  imports: [FeaturedProductsSectionEditorComponent],
  template: '<app-featured-products-section-editor [form]="form()" />',
})
class HostComponent {
  readonly form = signal<FeaturedProductsForm>(buildFeaturedProductsForm(new FormBuilder()));
}

describe('FeaturedProductsSectionEditorComponent', () => {
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

  it('starts invalid (the seeded productIds row is empty)', () => {
    expect(host.form().invalid).toBe(true);
  });

  it('becomes valid with a single valid productId and the default scroll variant', () => {
    const form = host.form();
    form.controls.productIds.at(0).setValue(PROD_A);
    form.markAsDirty();

    expect(form.valid).toBe(true);
    expect(form.controls.variant.value).toBe('scroll');
  });

  it('round-trips through the matching Zod schema', () => {
    const form = host.form();
    form.controls.productIds.at(0).setValue(PROD_A);
    form.controls.variant.setValue('grid');

    const raw = form.getRawValue();
    expect(() =>
      featuredProductsConfigSchema.parse({
        productIds: raw.productIds,
        variant: raw.variant,
      }),
    ).not.toThrow();
  });

  it('renders without axe-detectable violations', async () => {
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
