import { DialogModule } from '@angular/cdk/dialog';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { promotionalBannerConfigSchema } from '@admin-services';
import { buildPromotionalBannerForm, type PromotionalBannerForm } from './build-config-forms';
import { PromotionalBannerSectionEditorComponent } from './promotional-banner-section-editor.component';

expect.extend(toHaveNoViolations);

const ASSET_ID = '22222222-2222-4222-8222-222222222222';

function fill(form: PromotionalBannerForm, key: 'eyebrow' | 'headline' | 'body'): void {
  form.controls[key].setValue({ default: 'sample' });
}

@Component({
  standalone: true,
  imports: [PromotionalBannerSectionEditorComponent],
  template: '<app-promotional-banner-section-editor [form]="form()" />',
})
class HostComponent {
  readonly form = signal<PromotionalBannerForm>(buildPromotionalBannerForm(new FormBuilder()));
}

describe('PromotionalBannerSectionEditorComponent', () => {
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

  it('starts invalid (assetId + body strings required)', () => {
    expect(host.form().invalid).toBe(true);
  });

  it('does not require the CTA pair', () => {
    const form = host.form();
    form.controls.assetId.setValue(ASSET_ID);
    fill(form, 'eyebrow');
    fill(form, 'headline');
    fill(form, 'body');
    form.markAsDirty();

    expect(form.valid).toBe(true);
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
  ])(
    'Validators.pattern rejects ctaHref %s when populated (S21.7a admin-security-reviewer H-2)',
    (value) => {
      host.form().controls.ctaHref.setValue(value);
      expect(host.form().controls.ctaHref.invalid).toBe(true);
    },
  );

  it.each(['/catalog', 'https://example.com'])(
    'Validators.pattern accepts ctaHref %s when populated',
    (value) => {
      host.form().controls.ctaHref.setValue(value);
      expect(host.form().controls.ctaHref.errors?.['pattern']).toBeFalsy();
    },
  );

  it('round-trips through the matching Zod schema', () => {
    const form = host.form();
    form.controls.assetId.setValue(ASSET_ID);
    fill(form, 'eyebrow');
    fill(form, 'headline');
    fill(form, 'body');

    const raw = form.getRawValue();
    const value = {
      assetId: raw.assetId,
      eyebrow: raw.eyebrow,
      headline: raw.headline,
      body: raw.body,
    };
    expect(() => promotionalBannerConfigSchema.parse(value)).not.toThrow();
  });

  it('renders without axe-detectable violations', async () => {
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
