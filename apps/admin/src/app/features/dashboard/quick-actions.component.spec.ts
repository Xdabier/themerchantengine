import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { QuickActionsComponent } from './quick-actions.component';

expect.extend(toHaveNoViolations);

describe('QuickActionsComponent', () => {
  let fixture: ComponentFixture<QuickActionsComponent>;
  let component: QuickActionsComponent;
  let store: AuthStore;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
      ],
    });
    store = TestBed.inject(AuthStore);
    fixture = TestBed.createComponent(QuickActionsComponent);
    component = fixture.componentInstance;
  }

  it('shows no actions when the user has no permissions', () => {
    configure();
    fixture.detectChanges();
    expect(component.visible()).toEqual([]);
  });

  it('shows only the actions matching granted permissions', () => {
    configure();
    store.setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['products:create', 'gift_cards:create'],
        roles: [],
        status: 'active',
      },
    });
    expect(component.visible().map((a) => a.label)).toEqual(['New product', 'Issue gift card']);
  });

  it('surfaces the create-redirect quick-action once the user holds seo:create', () => {
    configure();
    store.setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['seo:create'],
        roles: [],
        status: 'active',
      },
    });
    expect(component.visible().map((a) => a.to)).toEqual(['/seo/redirects/new']);
  });

  it('surfaces the review queue once the user holds reviews:update', () => {
    configure();
    store.setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['reviews:update'],
        roles: [],
        status: 'active',
      },
    });
    expect(component.visible().map((a) => a.to)).toEqual(['/reviews']);
  });

  it('surfaces the returns quick-action once the user holds returns:update', () => {
    configure();
    store.setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['returns:update'],
        roles: [],
        status: 'active',
      },
    });
    expect(component.visible().map((a) => a.to)).toEqual(['/returns']);
  });

  it('derives stable test ids from paths', () => {
    configure();
    expect(component.testSuffix('/products/new')).toBe('products-new');
    expect(component.testSuffix('/gift-cards/issue')).toBe('gift-cards-issue');
  });

  it('has no axe violations when at least one action is visible', async () => {
    configure();
    store.setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['products:create', 'returns:update'],
        roles: [],
        status: 'active',
      },
    });
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
