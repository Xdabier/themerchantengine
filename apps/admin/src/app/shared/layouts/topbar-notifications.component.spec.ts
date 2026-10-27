import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificationsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { TopbarNotificationsComponent } from './topbar-notifications.component';

expect.extend(toHaveNoViolations);

describe('TopbarNotificationsComponent', () => {
  let fixture: ComponentFixture<TopbarNotificationsComponent>;
  let component: TopbarNotificationsComponent;
  let unreadSpy: jest.Mock;

  function configure(
    perms: string[] = ['notifications:view'],
    returnValue: ReturnType<typeof of> = of({ unreadCount: 2 }),
  ) {
    unreadSpy = jest.fn(() => returnValue);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: NotificationsService, useValue: { unreadCount: unreadSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(TopbarNotificationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    jest.useRealTimers();
    fixture?.destroy();
  });

  it('renders when the user has notifications:view', () => {
    configure();
    const anchor = fixture.nativeElement.querySelector('[data-testid="topbar-notifications"]');
    expect(anchor).toBeTruthy();
  });

  it('renders nothing when the user lacks notifications:view', () => {
    configure([]);
    const anchor = fixture.nativeElement.querySelector('[data-testid="topbar-notifications"]');
    expect(anchor).toBeFalsy();
  });

  it('calls unreadCount on mount and sets the signal', () => {
    configure();
    expect(unreadSpy).toHaveBeenCalledTimes(1);
    expect(component.unreadCount()).toBe(2);
  });

  it('renders the count badge when count > 0', () => {
    configure();
    const badge = fixture.nativeElement.querySelector('[data-testid="topbar-notifications-count"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('2');
    expect(badge?.getAttribute('aria-hidden')).toBeNull();
    expect(badge?.getAttribute('aria-label')).toBe('2 unread');
  });

  it('keeps the count span in the DOM when count is 0 but marks it aria-hidden', () => {
    configure(['notifications:view'], of({ unreadCount: 0 }));
    const badge = fixture.nativeElement.querySelector('[data-testid="topbar-notifications-count"]');
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.classList.contains('sr-only')).toBe(true);
    expect(badge?.textContent?.trim()).toBe('');
  });

  it('renders 99+ when count exceeds 99', () => {
    configure(['notifications:view'], of({ unreadCount: 250 }));
    expect(component.display()).toBe('99+');
  });

  it('outer anchor aria-label stays "Notifications" regardless of count', () => {
    configure();
    const anchor = fixture.nativeElement.querySelector('[data-testid="topbar-notifications"]');
    expect(anchor?.getAttribute('aria-label')).toBe('Notifications');
  });

  it('count live-region label reads "N unread" when count > 0', () => {
    configure();
    expect(component.countLabel()).toBe('2 unread');
  });

  it('polls every 60 seconds', () => {
    jest.useFakeTimers();
    configure();
    expect(unreadSpy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(unreadSpy).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(60_000);
    expect(unreadSpy).toHaveBeenCalledTimes(3);
  });

  it('clears the interval on destroy', () => {
    jest.useFakeTimers();
    configure();
    fixture.destroy();
    jest.advanceTimersByTime(60_000);
    expect(unreadSpy).toHaveBeenCalledTimes(1);
  });

  it('silently swallows a backend error without surfacing', () => {
    configure(
      ['notifications:view'],
      throwError(() => new Error('boom')),
    );
    expect(component.unreadCount()).toBe(0);
  });

  it('skips polling when isAuthenticated is false', () => {
    jest.useFakeTimers();
    configure();
    expect(unreadSpy).toHaveBeenCalledTimes(1);
    TestBed.inject(AuthStore).clear();
    jest.advanceTimersByTime(60_000);
    expect(unreadSpy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(unreadSpy).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations when count > 0', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when count is 0', async () => {
    configure(['notifications:view'], of({ unreadCount: 0 }));
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
