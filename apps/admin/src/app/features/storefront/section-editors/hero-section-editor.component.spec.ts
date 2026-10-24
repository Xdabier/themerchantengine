import { DialogModule } from '@angular/cdk/dialog';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { heroSectionConfigSchema } from '@admin-services';
import { buildHeroSectionForm, type HeroSectionForm } from './build-config-forms';
import { HeroSectionEditorComponent } from './hero-section-editor.component';

expect.extend(toHaveNoViolations);

const ASSET_ID = '11111111-1111-4111-8111-111111111111';

function fillTranslatable(
  form: HeroSectionForm,
  key: 'eyebrow' | 'headline' | 'body' | 'cta',
): void {
  form.controls[key].setValue({ default: 'sample' });
}

@Component({
  standalone: true,
  imports: [HeroSectionEditorComponent],
  template: '<app-hero-section-editor [form]="form()" />',
})
class HostComponent {
  readonly form = signal<HeroSectionForm>(buildHeroSectionForm(new FormBuilder()));
}

describe('HeroSectionEditorComponent', () => {
  let host: HostComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts invalid with required fields empty', () => {
    expect(host.form().invalid).toBe(true);
  });

  it('becomes valid when every required field is filled', () => {
    const form = host.form();
    form.controls.assetId.setValue(ASSET_ID);
    fillTranslatable(form, 'eyebrow');
    fillTranslatable(form, 'headline');
    fillTranslatable(form, 'body');
    fillTranslatable(form, 'cta');
    form.controls.ctaHref.setValue('/catalog');
    form.markAsDirty();

    expect(form.valid).toBe(true);
    expect(form.dirty).toBe(true);
  });

  it('rejects an asset id that is not a UUID v4', () => {
    host.form().controls.assetId.setValue('not-a-uuid');
    expect(host.form().controls.assetId.invalid).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://evil.com',
    'mailto:a@b',
    'tel:+1',
    '//evil.com',
    '\\\\evil.com',
    'evil.com',
    '   /catalog',
    '',
  ])('Validators.pattern rejects ctaHref %s (S21.7a admin-security-reviewer H-2)', (value) => {
    host.form().controls.ctaHref.setValue(value);
    expect(host.form().controls.ctaHref.invalid).toBe(true);
  });

  it.each(['/catalog', '/catalog/product/x', 'https://example.com', 'http://example.com'])(
    'Validators.pattern accepts ctaHref %s',
    (value) => {
      host.form().controls.ctaHref.setValue(value);
      expect(host.form().controls.ctaHref.errors?.['pattern']).toBeFalsy();
    },
  );

  it('round-trips through the matching Zod schema once filled', () => {
    const form = host.form();
    form.controls.assetId.setValue(ASSET_ID);
    fillTranslatable(form, 'eyebrow');
    fillTranslatable(form, 'headline');
    fillTranslatable(form, 'body');
    fillTranslatable(form, 'cta');
    form.controls.ctaHref.setValue('/catalog');
    form.controls.imageAlt.setValue({ default: '' });

    const value = form.getRawValue();
    // imageAlt is optional — strip it when default is empty so .strict() does not reject.
    if (!value.imageAlt.default) {
      delete (value as { imageAlt?: unknown }).imageAlt;
    }
    expect(() => heroSectionConfigSchema.parse(value)).not.toThrow();
  });

  it('renders without axe-detectable violations', async () => {
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
