import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CountriesService } from '@admin-services';
import { ApiForbiddenError } from '@admin-types';
import { FormFieldComponent } from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { CountrySelectComponent } from './country-select.component';

expect.extend(toHaveNoViolations);

const countriesFixture = {
  data: [
    {
      code: 'FR',
      name: 'France',
      region: 'Middle East',
      emoji: '🇫🇷',
      enabled: true,
      isDefault: true,
    },
    { code: 'FR', name: 'France', region: 'Europe', emoji: '🇫🇷', enabled: true, isDefault: false },
    {
      code: 'US',
      name: 'United States',
      region: 'Americas',
      emoji: '🇺🇸',
      enabled: false,
      isDefault: false,
    },
  ],
  defaultCode: 'FR',
};

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormFieldComponent, CountrySelectComponent],
  template: `
    <app-form-field label="Country" fieldId="host-country">
      <app-country-select id="host-country" [formControl]="control" />
    </app-form-field>
  `,
})
class HostComponent {
  readonly control = new FormControl('FR', { nonNullable: true });
}

describe('CountrySelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function configure(listCached: jest.Mock) {
    TestBed.configureTestingModule({
      providers: [{ provide: CountriesService, useValue: { listCached } }],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  }

  function select(): HTMLSelectElement | null {
    return fixture.nativeElement.querySelector('select');
  }

  describe('with the countries catalogue', () => {
    beforeEach(() => configure(jest.fn(() => of(countriesFixture))));

    it('offers countries by name with the code in brackets', () => {
      expect(select()?.textContent).toContain('France (FR)');
      expect(select()?.textContent).toContain('United States (US)');
    });

    it('groups the enabled shipping destinations first', () => {
      const groups = [...fixture.nativeElement.querySelectorAll('optgroup')] as HTMLElement[];
      expect(groups.map((g) => g.getAttribute('label'))).toEqual([
        'Shipping destinations',
        'Other countries',
      ]);
      expect(groups[0].textContent).toContain('France (FR)');
      expect(groups[0].textContent).toContain('France (FR)');
      expect(groups[1].textContent).toContain('United States (US)');
    });

    it('writes the ISO-2 code into the bound control on selection', () => {
      const el = select() as HTMLSelectElement;
      el.value = 'FR';
      el.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(host.control.value).toBe('FR');
    });

    it('reflects a value written by the form back into the select', () => {
      host.control.setValue('US');
      fixture.detectChanges();
      expect(select()?.value).toBe('US');
    });

    it('has no axe violations', async () => {
      expect(await axe(fixture.nativeElement)).toHaveNoViolations();
    });
  });

  describe('when the catalogue cannot be read', () => {
    beforeEach(() =>
      configure(
        jest.fn(() =>
          throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
        ),
      ),
    );

    it('degrades to the validated ISO-2 text input', () => {
      expect(select()).toBeNull();
      const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('FR');
      expect(fixture.nativeElement.textContent).toContain('Two uppercase letters');
    });

    it('still writes to the bound control', () => {
      const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
      input.value = 'fr';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(host.control.value).toBe('FR');
    });

    it('has no axe violations in the fallback mode', async () => {
      expect(await axe(fixture.nativeElement)).toHaveNoViolations();
    });
  });
});
