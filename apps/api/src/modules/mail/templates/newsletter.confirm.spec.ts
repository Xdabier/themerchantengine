import { render } from './newsletter.confirm';
import type { MailBrand } from '../mail.types';

describe('newsletter.confirm template', () => {
  const vars = { confirmUrl: 'https://api.example.test/api/v1/newsletter/confirm?token=abc' };
  const brand: MailBrand = { storeName: 'Maison Exemple' };

  it('renders an en subject + body with the confirm URL and the store name', () => {
    const out = render('en', vars, brand);
    expect(out.subject).toContain('Confirm');
    expect(out.subject).toContain(brand.storeName);
    expect(out.html).toContain(vars.confirmUrl);
    expect(out.html).toContain(brand.storeName);
    expect(out.text).toContain(vars.confirmUrl);
  });

  it('renders a fr subject + body with the confirm URL and the store name', () => {
    const out = render('fr', vars, brand);
    expect(out.subject).toContain('Confirmez votre abonnement');
    expect(out.subject).toContain(brand.storeName);
    expect(out.html).toContain("Confirmer l'abonnement");
    expect(out.html).toContain(vars.confirmUrl);
    expect(out.html).toContain(brand.storeName);
    expect(out.text).toContain(vars.confirmUrl);
  });

  it('renders an ar subject + body with the confirm URL and the store name', () => {
    const out = render('ar', vars, brand);
    expect(out.subject).toContain('تأكيد اشتراكك');
    expect(out.subject).toContain(brand.storeName);
    expect(out.html).toContain('تأكيد الاشتراك');
    expect(out.html).toContain(vars.confirmUrl);
    expect(out.html).toContain(brand.storeName);
    expect(out.text).toContain(vars.confirmUrl);
  });
});
