import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { SearchAdminService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { SynonymsListPage } from './synonyms-list.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const synonym = {
  id: 'syn-1',
  terms: ['shoe', 'sneaker', 'trainer'],
  isActive: true,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
};

describe('SynonymsListPage', () => {
  let fixture: ComponentFixture<SynonymsListPage>;
  let page: SynonymsListPage;
  let listSpy: jest.Mock;
  let createSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let permissions: Set<string>;
  let dialogResult: boolean;

  function configure(params: Record<string, string> = {}) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: SearchAdminService,
          useValue: {
            listSynonyms: listSpy,
            createSynonym: createSpy,
            deleteSynonym: deleteSpy,
          },
        },
        {
          provide: AuthStore,
          useValue: { locale: () => 'fr', hasPermission: (p: string) => permissions.has(p) },
        },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
        {
          provide: Dialog,
          useValue: {
            open: jest.fn(() => ({ closed: of(dialogResult) })),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SynonymsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = new Set(['products:update']);
    dialogResult = true;
    listSpy = jest.fn(() => of({ data: [synonym], meta: { page: 1, pageSize: 20, total: 1 } }));
    createSpy = jest.fn(() => of(synonym));
    deleteSpy = jest.fn(() => of(undefined));
  });

  it('fetches with defaults and renders one row per group', () => {
    configure();
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(`[data-testid="synonym-row-${synonym.id}"]`)).toBeTruthy();
  });

  it('forwards page from URL', () => {
    configure({ page: '2' });
    expect(listSpy).toHaveBeenCalledWith({ page: 2, pageSize: 20 });
  });

  it('commitTerm adds a term and rejects the >100-char input via status message', () => {
    configure();
    page.termInput.setValue('shoe');
    page.commitTerm();
    expect(page.draftTerms()).toEqual(['shoe']);

    page.termInput.setValue('x'.repeat(101));
    page.commitTerm();
    expect(page.status()?.tone).toBe('error');
    expect(page.draftTerms()).toEqual(['shoe']);
  });

  it('submitCreate stays a no-op below two terms', () => {
    configure();
    page.draftTerms.set(['only']);
    page.submitCreate();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('submitCreate posts two terms and announces success', () => {
    configure();
    page.draftTerms.set(['shoe', 'sneaker']);
    page.submitCreate();
    expect(createSpy).toHaveBeenCalledWith({ terms: ['shoe', 'sneaker'] });
    expect(page.status()?.tone).toBe('success');
  });

  it('confirmDelete calls deleteSynonym when confirmed', async () => {
    configure();
    await page.confirmDelete(synonym);
    expect(deleteSpy).toHaveBeenCalledWith(synonym.id);
  });

  it('confirmDelete skips delete when cancelled', async () => {
    dialogResult = false;
    configure();
    await page.confirmDelete(synonym);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('hides the create form when caller lacks products:update', () => {
    permissions = new Set();
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="synonym-create-submit"]')).toBeNull();
  });

  it('surfaces a list error in the alert banner', () => {
    listSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(page.error()).toBeTruthy();
  });

  it('is a11y-clean at the default mount', async () => {
    configure();
    const results = await axe(fixture.nativeElement as HTMLElement);
    expect(results).toHaveNoViolations();
  });
});
