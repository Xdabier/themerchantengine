import { TestBed } from '@angular/core/testing';
import { LoadErrorComponent } from './load-error.component';

describe('LoadErrorComponent', () => {
  function mount(inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ imports: [LoadErrorComponent] });
    const fixture = TestBed.createComponent(LoadErrorComponent);
    fixture.componentRef.setInput('message', 'Could not load locations.');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('announces the failure to assistive tech', () => {
    const fixture = mount();
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('Could not load locations.');
  });

  it('emits retry when the operator clicks Retry', () => {
    const fixture = mount({ testId: 'inventory-locations-degraded' });
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => (retries += 1));
    const button = fixture.nativeElement.querySelector(
      '[data-testid="inventory-locations-degraded-retry"]',
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    button.click();
    expect(retries).toBe(1);
  });

  it('renders a compact variant for degraded companion data', () => {
    const fixture = mount({ compact: true });
    const root = fixture.nativeElement.querySelector('[role="alert"]');
    expect(root.className).toContain('px-3');
    expect(root.querySelector('p')?.className).toContain('text-xs');
  });

  it('can hide the retry control when there is nothing to re-fire', () => {
    const fixture = mount({ showRetry: false });
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('marks the retry button busy while a retry is in flight', () => {
    const fixture = mount({ retrying: true });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
  });

  it('names the retry control when several share a screen', () => {
    const fixture = mount({ retryLabel: 'locations' });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Retry: locations');
  });
});
