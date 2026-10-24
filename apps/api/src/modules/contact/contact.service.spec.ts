import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { ContactService } from './contact.service';

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('ContactService', () => {
  let service: ContactService;
  let mail: { enqueue: jest.Mock };
  let configValues: Record<string, string>;

  beforeEach(() => {
    mail = { enqueue: jest.fn().mockResolvedValue({ logId: 'l1' }) };
    configValues = { CONTACT_FORM_RECIPIENT: 'support@example.test' };
    const config = {
      get: jest.fn((key: string, dflt?: unknown) => configValues[key] ?? dflt),
    };
    service = new ContactService(
      mail as unknown as MailService,
      config as unknown as ConfigService,
    );
  });

  const dto = {
    fromName: 'Sam Shopper',
    fromEmail: 'sam@example.com',
    subjectLine: 'Where is my order?',
    message: 'Hello, I have a question.',
  };

  it('enqueues contact-form to staff with replyTo set to the submitter', async () => {
    const result = await service.submit(dto);

    expect(mail.enqueue).toHaveBeenCalledWith(
      'contact-form',
      expect.objectContaining({
        to: 'support@example.test',
        locale: 'fr',
        replyTo: 'sam@example.com',
        variables: expect.objectContaining({
          fromName: 'Sam Shopper',
          fromEmail: 'sam@example.com',
          subjectLine: 'Where is my order?',
          message: 'Hello, I have a question.',
          submittedAt: expect.any(String),
        }),
      }),
    );
    expect(result).toEqual({ status: 'received' });
  });

  // The stamp used to be a raw `toISOString()`, `Z` suffix and all, landing in
  // a French staff notice. It is now the locale form the body is written in.
  it('stamps the submission as a readable French date, not an ISO timestamp', async () => {
    await service.submit(dto);

    const call = mail.enqueue.mock.calls.find((c) => c[0] === 'contact-form');
    const submittedAt = call[1].variables.submittedAt as string;
    expect(submittedAt).toMatch(
      /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d{1,2} \p{L}+ \d{4} à \d{2}:\d{2}$/u,
    );
    expect(submittedAt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(submittedAt).not.toContain('Z');
  });

  it('adds a bcc fan-out when CONTACT_FORM_BCC is configured', async () => {
    configValues.CONTACT_FORM_BCC = 'ops@example.test, lead@example.test';

    await service.submit(dto);

    const call = mail.enqueue.mock.calls.find((c) => c[0] === 'contact-form');
    expect(call[1].bcc).toEqual(['ops@example.test', 'lead@example.test']);
  });

  // The recipient default used to be another client's inbox, so an unset
  // CONTACT_FORM_RECIPIENT silently mailed a customer question off-domain.
  it('falls back to the example.test inbox when no recipient is configured', async () => {
    delete configValues.CONTACT_FORM_RECIPIENT;

    await service.submit(dto);

    const call = mail.enqueue.mock.calls.find((c) => c[0] === 'contact-form');
    expect(call[1].to).toBe('contact@example.test');
  });

  it('omits bcc when none is configured', async () => {
    await service.submit(dto);

    const call = mail.enqueue.mock.calls.find((c) => c[0] === 'contact-form');
    expect(call[1]).not.toHaveProperty('bcc');
  });
});
