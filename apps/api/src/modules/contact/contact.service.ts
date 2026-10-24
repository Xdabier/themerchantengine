import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import type { ContactFormDto } from './dto/contact-form.dto';
import { resolveMailIdentity } from '../mail/config/mail-identity';
import { defaultMailLocale } from '../mail/mail.types';
import { formatMailDateTime } from '../mail/mail-date.util';

/**
 * Storefront contact form (NE5). The `contact-form` template + the enqueue
 * `bcc`/`replyTo` plumbing already existed but had no caller — this is the
 * caller. The submission goes to the staff inbox with `replyTo` set to the
 * submitter (so staff reply straight to the customer) and an optional `bcc`
 * fan-out to additional staff addresses.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async submit(dto: ContactFormDto): Promise<{ status: 'received' }> {
    const recipient = resolveMailIdentity(this.config).contactRecipient;
    const bcc = (this.config.get<string>('CONTACT_FORM_BCC', '') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    await this.mail.enqueue('contact-form', {
      to: recipient,
      locale: defaultMailLocale(),
      replyTo: dto.fromEmail,
      ...(bcc.length ? { bcc } : {}),
      variables: {
        fromName: dto.fromName,
        fromEmail: dto.fromEmail,
        subjectLine: dto.subjectLine,
        message: dto.message,
        // Same locale the message renders in, so the stamp is spelled the way
        // the rest of the body is rather than as a machine timestamp.
        submittedAt: formatMailDateTime(new Date(), defaultMailLocale()),
      },
    });

    this.logger.log(`contact submitted from=${dto.fromEmail}`);
    return { status: 'received' };
  }
}
