import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { trustSignalsConfigSchema } from '@admin-services';
import { buildTrustSignalsForm, type TrustSignalsForm } from './build-config-forms';
import { TrustSignalsSectionEditorComponent } from './trust-signals-section-editor.component';

expect.extend(toHaveNoViolations);

@Component({
  standalone: true,
  imports: [TrustSignalsSectionEditorComponent],
  template: '<app-trust-signals-section-editor [form]="form()" />',
})
class HostComponent {
  readonly form = signal<TrustSignalsForm>(buildTrustSignalsForm(new FormBuilder()));
}

describe('TrustSignalsSectionEditorComponent', () => {
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

  it('starts invalid (the seeded first pillar has empty title + subtitle)', () => {
    expect(host.form().invalid).toBe(true);
  });

  it('becomes valid when the pillar title + subtitle are filled', () => {
    const item = host.form().controls.items.at(0);
    item.controls.title.setValue({ default: 'Fast' });
    item.controls.subtitle.setValue({ default: 'Two-day' });
    host.form().markAsDirty();

    expect(host.form().valid).toBe(true);
  });

  it('round-trips through the matching Zod schema', () => {
    const item = host.form().controls.items.at(0);
    item.controls.title.setValue({ default: 'Fast' });
    item.controls.subtitle.setValue({ default: 'Two-day' });

    const raw = host.form().getRawValue();
    expect(() =>
      trustSignalsConfigSchema.parse({
        items: raw.items.map((it) => ({
          kind: it.kind,
          title: it.title,
          subtitle: it.subtitle,
        })),
      }),
    ).not.toThrow();
  });

  it('renders without axe-detectable violations', async () => {
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
