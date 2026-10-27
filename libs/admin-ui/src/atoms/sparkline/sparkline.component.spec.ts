import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { SparklineComponent } from './sparkline.component';

@Component({
  standalone: true,
  imports: [SparklineComponent],
  template: `<app-sparkline [values]="values" [width]="100" [height]="20" />`,
})
class Host {
  values: number[] = [];
}

describe('SparklineComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
  });

  it('renders nothing with fewer than 2 points', () => {
    host.values = [5];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('draws a polyline across the viewBox when values climb', () => {
    host.values = [0, 10, 20];
    fixture.detectChanges();
    const polyline = fixture.nativeElement.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const points = polyline.getAttribute('points') as string;
    // Three points, x=0,50,100 for width=100 and 3 values.
    expect(points.split(' ')).toHaveLength(3);
    expect(points).toContain('0.00');
    expect(points).toContain('100.00');
  });

  it('centers a flat line vertically so zero-change still renders', () => {
    host.values = [5, 5, 5];
    fixture.detectChanges();
    const polyline = fixture.nativeElement.querySelector('polyline');
    const points = (polyline.getAttribute('points') as string).split(' ');
    for (const p of points) {
      const [, y] = p.split(',');
      expect(y).toBe('10.00'); // height/2
    }
  });
});
