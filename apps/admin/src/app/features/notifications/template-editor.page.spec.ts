import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEUTRAL_LOCALE_SET } from '@merchants/shared-common';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { NotificationTemplatesService } from '@admin-services';
import { ApiConflictError, ApiError, ApiNotFoundError } from '@admin-types';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { TemplateEditorPage } from './template-editor.page';

expect.extend(toHaveNoViolations);

const templateFixture = {
  id: 'tmpl-1',
  code: 'order.shipped',
  subject: { default: 'Your order has shipped' },
  body: { default: 'Hi {{customerName}}' },
  channel: 'email' as const,
  event: 'order.shipped',
  variables: ['customerName'],
  isEnabled: true,
};

describe('TemplateEditorPage', () => {
  let fixture: ComponentFixture<TemplateEditorPage>;
  let page: TemplateEditorPage;
  let getSpy: jest.Mock;
  let createSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let previewSpy: jest.Mock;
  let sendTestSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  function configure(
    id: string | null = 'tmpl-1',
    perms: string[] = ['notifications:view', 'notifications:manage'],
  ) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap(id ? { id } : {}));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: NotificationTemplatesService,
          useValue: {
            getTemplate: getSpy,
            createTemplate: createSpy,
            updateTemplate: updateSpy,
            deleteTemplate: deleteSpy,
            preview: previewSpy,
            sendTest: sendTestSpy,
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(TemplateEditorPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(templateFixture));
    createSpy = jest.fn(() => of({ ...templateFixture, id: 'tmpl-new' }));
    updateSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({ ...templateFixture, ...body }),
    );
    deleteSpy = jest.fn(() => of(undefined));
    previewSpy = jest.fn(() =>
      of({
        en: { subject: 'EN subject', html: '<html>en body</html>', text: 'en body' },
        fr: { subject: 'Sujet FR', html: '<html>corps fr</html>', text: 'corps fr' },
      }),
    );
    sendTestSpy = jest.fn(() => of({ status: 'queued', recipient: 'a@b', logId: 'log-1' }));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('toggles isEmail live when the channel changes in create mode (zoneless reactivity)', () => {
    configure(null); // create mode — channel is editable, defaults to 'email'
    // Regression guard for the memoized-computed bug: the Subject field is gated
    // by isEmail(); a computed() over the channel control value freezes under
    // zoneless CD, so the field would never toggle when the channel changes.
    expect(page.isEmail()).toBe(true);

    page.form.controls.channel.setValue('sms');
    fixture.detectChanges();

    expect(page.isEmail()).toBe(false);
  });

  it('seeds form for an existing template', () => {
    configure('tmpl-1');
    expect(page.form.controls.body.value.default).toBe('Hi {{customerName}}');
    expect(page.form.controls.code.disabled).toBe(true);
    expect(page.form.controls.channel.disabled).toBe(true);
  });

  it('update ships only dirty fields', () => {
    configure('tmpl-1');
    page.form.controls.isEnabled.setValue(false);
    page.form.controls.isEnabled.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('tmpl-1', { isEnabled: false });
  });

  it('new template requires valid code + event', () => {
    configure('new');
    expect(page.isNew()).toBe(true);
    page.form.controls.code.setValue('Invalid Code');
    page.form.controls.event.setValue('order.created');
    page.form.controls.body.setValue({ default: 'Hi' });
    page.save();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('switching channel to sms clears subject', () => {
    configure('new');
    page.form.controls.channel.setValue('sms');
    expect(page.form.controls.subject.disabled).toBe(true);
    expect(page.form.controls.subject.value.default).toBe('');
  });

  it('confirmDelete goes through openConfirmDialog', async () => {
    configure('tmpl-1');
    await page.confirmDelete();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('tmpl-1');
  });

  it('404 surfaces a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'x' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Template not found.');
  });

  it('409 on create surfaces the conflict message', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CODE_TAKEN', message: 'dup' })),
    );
    configure('new');
    page.form.controls.code.setValue('order.created');
    page.form.controls.event.setValue('order.created');
    page.form.controls.body.setValue({ default: 'Hi' });
    page.save();
    expect(page.error()).toBe('Code conflict — pick a different code.');
  });

  it('has no axe violations', async () => {
    configure('tmpl-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── NE6 editor upgrade ──────────────────────────────────────────────────────

  it('flags an undeclared {{token}} and blocks save', () => {
    configure('tmpl-1');
    page.form.controls.body.setValue({ default: 'Hi {{customerName}} {{ghost}}' });
    page.form.controls.body.markAsDirty();
    expect(page.unknownTokens()).toContain('ghost');
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('accepts the body once every token is declared', () => {
    configure('tmpl-1');
    page.form.controls.body.setValue({ default: 'Hi {{customerName}}' });
    page.form.controls.body.markAsDirty();
    expect(page.unknownTokens()).toHaveLength(0);
    page.save();
    expect(updateSpy).toHaveBeenCalled();
  });

  it('runPreview renders both locales via the preview endpoint', () => {
    configure('tmpl-1');
    page.runPreview();
    expect(previewSpy).toHaveBeenCalledWith(
      'tmpl-1',
      expect.objectContaining({ body: expect.anything() }),
    );
    expect(page.previewResult()?.en.html).toContain('en body');
    page.setPreviewLocale('fr');
    expect(page.activePreview()?.html).toContain('corps fr');
  });

  it('offers the bridge locales before a preview has run, and the response keys after', () => {
    // The mail renderer decides which locales exist, not the store. Before a
    // preview the editor shows the store's locales; after one it shows exactly
    // the keys the response carried, so D7 moving the renderer needs no change
    // here.
    configure('tmpl-1');
    expect(page.previewLocales()).toEqual(NEUTRAL_LOCALE_SET.supportedLocales);
    page.runPreview();
    expect(page.previewLocales()).toEqual(['en', 'fr']);
  });

  it('clamps the active preview locale to a key the response actually carries', () => {
    configure('tmpl-1');
    page.runPreview();
    page.setPreviewLocale('fr');
    expect(page.previewLocale()).toBe('fr');

    // A response that carries only one locale must not leave the editor pointed
    // at an absent key rendering a blank preview.
    previewSpy.mockReturnValue(of({ en: { subject: 'S', html: 'only en', text: 'S' } }));
    page.runPreview();

    expect(page.previewLocale()).toBe('en');
    expect(page.activePreview()?.html).toContain('only en');
  });

  it('sendTest enqueues to the operator and surfaces the queued outcome', () => {
    configure('tmpl-1');
    page.sendTest();
    // No preview has run, so the active locale is the store default and that is
    // the language the operator's own test copy arrives in.
    expect(sendTestSpy).toHaveBeenCalledWith('tmpl-1', {
      locale: NEUTRAL_LOCALE_SET.defaultLocale,
    });
    expect(page.testNotice()).toContain('Queued');
  });

  it('sendTest surfaces a skipped (flow off) outcome', () => {
    sendTestSpy = jest.fn(() => of({ status: 'skipped', recipient: 'a@b', logId: 'l' }));
    configure('tmpl-1');
    page.sendTest();
    expect(page.testNotice()).toContain('off');
  });

  it('sendTest surfaces a suppressed outcome', () => {
    sendTestSpy = jest.fn(() => of({ status: 'suppressed', recipient: 'a@b', logId: 'l' }));
    configure('tmpl-1');
    page.sendTest();
    expect(page.testNotice()).toContain('suppressed');
  });

  it('runPreview surfaces an error when the preview endpoint fails', () => {
    previewSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL', message: 'render boom', status: 500 })),
    );
    configure('tmpl-1');
    page.runPreview();
    expect(page.previewError()).toBe('render boom');
  });

  it('sendTest surfaces an error when the endpoint fails', () => {
    sendTestSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL', message: 'send boom', status: 500 })),
    );
    configure('tmpl-1');
    page.sendTest();
    expect(page.previewError()).toBe('send boom');
  });

  it('has no axe violations with the preview expanded', async () => {
    configure('tmpl-1');
    page.runPreview();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
