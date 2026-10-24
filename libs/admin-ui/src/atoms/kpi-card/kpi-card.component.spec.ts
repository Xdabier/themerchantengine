import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { KpiCardComponent } from './kpi-card.component';

@Component({
  standalone: true,
  imports: [KpiCardComponent],
  template: `
    <app-kpi-card
      [label]="label"
      [value]="value"
      [delta]="delta"
      [sublabel]="sublabel"
      [trendPoints]="trend"
      [loading]="loading"
      testId="kpi-test"
    />
  `,
})
class Host {
  label = 'Revenue';
  value = '1,200';
  delta: number | null = null;
  sublabel: string | null = null;
  trend: readonly number[] = [];
  loading = false;
}

describe('KpiCardComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
  });

  it('renders skeleton rows when loading', () => {
    host.loading = true;
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('span.bg-surface-elevated').length,
    ).toBeGreaterThan(0);
  });

  it('renders value + sublabel when not loading and no delta is set', () => {
    host.sublabel = 'Last 24h';
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Revenue');
    expect(text).toContain('1,200');
    expect(text).toContain('Last 24h');
  });

  it('uses success tone for positive delta', () => {
    host.delta = 12.4;
    fixture.detectChanges();
    const delta = fixture.nativeElement.querySelector('[data-testid="kpi-test-delta"]');
    expect(delta.className).toContain('text-status-success');
  });

  it('uses error tone for negative delta', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.delta = -3.1;
    f.detectChanges();
    const delta = f.nativeElement.querySelector('[data-testid="kpi-test-delta"]');
    expect(delta.className).toContain('text-status-error');
  });

  it('hides the sparkline when fewer than 2 values are provided', () => {
    host.trend = [1];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('shows the sparkline when ≥ 2 values are provided', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.trend = [1, 2, 3];
    f.detectChanges();
    expect(f.nativeElement.querySelector('svg')).not.toBeNull();
  });
});
