import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ActivityFeedComponent, type ActivityItem } from './activity-feed.component';

expect.extend(toHaveNoViolations);

const items: ActivityItem[] = [
  {
    id: 'a1',
    sentence: 'Super Admin deleted a webhook',
    action: 'webhook.delete',
    entityType: 'webhook',
    entityId: 'w1',
    at: '2026-04-16T10:00:00.000Z',
    actor: 'Super Admin',
  },
];

describe('ActivityFeedComponent', () => {
  let fixture: ComponentFixture<ActivityFeedComponent>;

  function configure(
    inputs: { items?: ActivityItem[]; loading?: boolean; linkable?: boolean } = {},
  ) {
    TestBed.configureTestingModule({
      imports: [ActivityFeedComponent],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    fixture = TestBed.createComponent(ActivityFeedComponent);
    fixture.componentRef.setInput('items', inputs.items ?? items);
    fixture.componentRef.setInput('loading', inputs.loading ?? false);
    fixture.componentRef.setInput('linkable', inputs.linkable ?? false);
    fixture.detectChanges();
  }

  function anchor(): HTMLAnchorElement | null {
    return fixture.nativeElement.querySelector('[data-testid="activity-link"]');
  }

  it('renders the sentence and the timestamp, never the raw audit keys', () => {
    configure();
    const row = fixture.nativeElement.querySelector('[data-testid="activity-list"]') as HTMLElement;
    expect(row.textContent).toContain('Super Admin deleted a webhook');
    expect(row.textContent).not.toContain('webhook.delete');
    expect(row.textContent?.trim().endsWith('webhook')).toBe(false);
  });

  // ── QA C6: the rows describe entities that already have a drill-down route ─

  it('links a row to its audit entity page when linking is allowed', () => {
    configure({ linkable: true });
    const link = anchor();
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/audit-logs/webhook/w1');
    // A screen reader must hear a destination, not a sentence fragment.
    expect(link!.getAttribute('aria-label')).toContain('Super Admin deleted a webhook');
    expect(link!.getAttribute('aria-label')).toContain('audit');
  });

  it('stays plain text when the operator lacks audit_log:view', () => {
    configure({ linkable: false });
    expect(anchor()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Super Admin deleted a webhook');
  });

  it('stays plain text for a row with no target entity', () => {
    configure({ linkable: true, items: [{ ...items[0], entityId: null }] });
    expect(anchor()).toBeNull();
  });

  it('has no axe violations with links on', async () => {
    configure({ linkable: true });
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });

  it('shows the empty copy when there is nothing to show', () => {
    configure({ items: [] });
    expect(fixture.nativeElement.textContent).toContain('No activity in the last 24 hours.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
