import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEUTRAL_LOCALE_SET } from '@merchants/shared-common';
import { provideRouter } from '@angular/router';
import { CampaignsService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CampaignEditorPage } from './campaign-editor.page';

void adminUi;
expect.extend(toHaveNoViolations);

const campaignFixture = {
  id: 'camp-1',
  name: 'Spring sale',
  subject: { en: 'Sale', fr: 'Vente' },
  body: { en: 'Shop', fr: 'Achetez' },
  segment: 'ALL_CONFIRMED' as const,
  couponCode: null,
  status: 'DRAFT' as const,
  kind: 'BROADCAST' as const,
};

describe('CampaignEditorPage (new)', () => {
  let fixture: ComponentFixture<CampaignEditorPage>;
  let page: CampaignEditorPage;
  let createSpy: jest.Mock;

  function makePreviewSpy(): void {
    sendTestSpy = jest.fn(() => of({ status: 'sent', recipient: 'a@b' }));
    previewSpy = jest.fn(() =>
      of({
        en: { subject: 'EN subject', html: '<p>en</p>', text: 'en' },
        fr: { subject: 'Sujet FR', html: '<p>fr</p>', text: 'fr' },
      }),
    );
  }

  function configure(perms: string[] = ['campaigns:view', 'campaigns:create', 'campaigns:manage']) {
    makePreviewSpy();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: CampaignsService,
          useValue: {
            getCampaign: jest.fn(() => of(campaignFixture)),
            createCampaign: createSpy,
            updateCampaign: jest.fn(() => of(campaignFixture)),
            deleteCampaign: jest.fn(() => of(undefined)),
            preview: previewSpy,
            sendTestCampaign: sendTestSpy,
            sendCampaign: jest.fn(() => of({ id: 'camp-1', status: 'SENDING' })),
          },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CampaignEditorPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSpy = jest.fn(() => of(campaignFixture));
  });

  it('mounts in new mode (no route id)', () => {
    configure();
    expect(page.isNew()).toBe(true);
    expect(page.loading()).toBe(false);
  });

  it('save() on a valid new form calls createCampaign', () => {
    configure();
    page.form.controls.name.setValue('Launch');
    page.form.controls.subject.setValue({ default: 'Hi', en: 'Hi' });
    page.form.controls.body.setValue({ default: 'Body', en: 'Body' });
    page.save();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].name).toBe('Launch');
  });

  it('flags an undeclared placeholder token in the body', () => {
    configure();
    page.form.controls.body.setValue({ default: 'Use {{ghostToken}}', en: 'Use {{ghostToken}}' });
    expect(page.unknownTokens()).toContain('ghostToken');
  });

  it('canManage is false for create-only perms (no manage)', () => {
    configure(['campaigns:view', 'campaigns:create']);
    expect(page.canManage()).toBe(false);
  });

  it('has no axe violations on the new-campaign form', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /**
   * The editor early-returns from `runPreview()` without a loaded campaign, so
   * these seed one. Asserting on `previewLocales()` alone would not have caught
   * that: the bridge and the renderer's current pair are the same two codes, so
   * the list matches either way. The subject assertions are what prove a preview
   * actually ran.
   */
  function withLoadedCampaign(): void {
    configure();
    page.current.set(campaignFixture as never);
    fixture.detectChanges();
  }

  it('offers the bridge locales before a preview has run, and the response keys after', () => {
    // The mail renderer decides which locales exist, not the store, so this page
    // must not follow `supportedLocales`. Before a preview it shows the bridge;
    // after one it shows exactly what the response carried.
    withLoadedCampaign();
    expect(page.previewResult()).toBeNull();
    expect(page.previewLocales()).toEqual(NEUTRAL_LOCALE_SET.supportedLocales);

    page.runPreview();

    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(page.previewLocales()).toEqual(['en', 'fr']);
    expect(page.activePreview()?.subject).toBe('EN subject');
  });

  it('clamps the active preview locale to a key the response actually carries', () => {
    withLoadedCampaign();
    page.runPreview();
    page.setPreviewLocale('fr');
    expect(page.previewLocale()).toBe('fr');
    expect(page.activePreview()?.subject).toBe('Sujet FR');

    previewSpy.mockReturnValue(of({ en: { subject: 'only en', html: '<p>x</p>', text: 'x' } }));
    page.runPreview();

    expect(page.previewLocale()).toBe('en');
    expect(page.activePreview()?.subject).toBe('only en');
  });

  it('sends a test in a locale the mail renderer actually supports', () => {
    withLoadedCampaign();
    page.runPreview();
    page.setPreviewLocale('fr');
    page.sendTest();
    expect(sendTestSpy).toHaveBeenCalledWith('camp-1', { locale: 'fr' });
  });
});
