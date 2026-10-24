import { DialogModule } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { StorefrontConfigService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { StorefrontSectionEditorPage } from './section-editor.page';

expect.extend(toHaveNoViolations);

const ASSET_ID = '11111111-1111-4111-8111-111111111111';

describe('StorefrontSectionEditorPage', () => {
  let fixture: ComponentFixture<StorefrontSectionEditorPage>;
  let createSectionSpy: jest.Mock;
  let listSectionsSpy: jest.Mock;
  const paramMap$ = new BehaviorSubject({
    get: (key: string) => (key === 'pageSlug' ? 'home' : null),
  });

  function configure() {
    TestBed.configureTestingModule({
      imports: [DialogModule],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: StorefrontConfigService,
          useValue: {
            createSection: createSectionSpy,
            listPages: jest.fn(() => of({ data: ['home'] })),
            listSections: listSectionsSpy ?? jest.fn(() => of({ data: [], meta: {} })),
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['storefront_config:view', 'storefront_config:manage'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(StorefrontSectionEditorPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSectionSpy = jest.fn(() => of({ id: 's-1', pageSlug: 'home' }));
    listSectionsSpy = jest.fn(() => of({ data: [], meta: {} }));
  });

  it('mounts in create mode and seeds the active pageSlug', () => {
    configure();
    expect(fixture.componentInstance.isEdit()).toBe(false);
    expect(fixture.componentInstance.pageSlug()).toBe('home');
  });

  it('installs the HERO config form by default in create mode', () => {
    configure();
    expect(fixture.componentInstance.heroForm()).not.toBeNull();
    expect(fixture.componentInstance.promotionalBannerForm()).toBeNull();
  });

  it('swaps the active config form when the type selector changes', () => {
    configure();
    fixture.componentInstance.envelopeForm.controls.type.setValue('TRUST_SIGNALS');
    fixture.componentInstance.onTypeChange();
    expect(fixture.componentInstance.heroForm()).toBeNull();
    expect(fixture.componentInstance.trustSignalsForm()).not.toBeNull();
  });

  it('does not render the legacy raw-JSON configText textarea', () => {
    configure();
    const node = fixture.nativeElement.querySelector('[formControlName="configText"]');
    expect(node).toBeNull();
  });

  it('keeps the save button disabled until a valid hero config is in place', () => {
    configure();
    const inst = fixture.componentInstance;
    expect(inst.canSave()).toBe(false);

    const hero = inst.heroForm()!;
    hero.controls.assetId.setValue(ASSET_ID);
    hero.controls.eyebrow.setValue({ default: 'Summer' });
    hero.controls.headline.setValue({ default: 'Sun and surf' });
    hero.controls.body.setValue({ default: 'Discover' });
    hero.controls.cta.setValue({ default: 'Shop now' });
    hero.controls.ctaHref.setValue('/catalog');
    hero.markAsDirty();

    expect(inst.canSave()).toBe(true);
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    createSectionSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    const inst = fixture.componentInstance;
    inst.envelopeForm.patchValue({ type: 'HERO' });
    inst.envelopeForm.markAsDirty();
    const hero = inst.heroForm()!;
    hero.controls.assetId.setValue(ASSET_ID);
    hero.controls.eyebrow.setValue({ default: 'A' });
    hero.controls.headline.setValue({ default: 'A' });
    hero.controls.body.setValue({ default: 'A' });
    hero.controls.cta.setValue({ default: 'A' });
    hero.controls.ctaHref.setValue('/catalog');
    hero.markAsDirty();
    inst.save();
    expect(inst.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    createSectionSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    const inst = fixture.componentInstance;
    const hero = inst.heroForm()!;
    hero.controls.assetId.setValue(ASSET_ID);
    hero.controls.eyebrow.setValue({ default: 'A' });
    hero.controls.headline.setValue({ default: 'A' });
    hero.controls.body.setValue({ default: 'A' });
    hero.controls.cta.setValue({ default: 'A' });
    hero.controls.ctaHref.setValue('/catalog');
    hero.markAsDirty();
    inst.envelopeForm.markAsDirty();
    inst.save();
    expect(inst.error()).toBe('Section not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
