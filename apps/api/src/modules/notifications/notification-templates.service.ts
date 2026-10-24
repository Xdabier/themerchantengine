import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { resolveTranslatable } from '@common/interceptors';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import { sanitizeTranslatableEmailHtml } from '@common/utils';
import { MailService } from '../mail/mail.service';
import { NOTIFICATION_TEMPLATE_CHANGED_EVENT } from '../mail/mail.constants';
import { extractTemplateTokens, renderDraft } from '../mail/templates/render';
import type { MailJobName, MailLocale, RenderedTemplate } from '../mail/mail.types';
import type {
  CreateNotificationTemplateDto,
  PreviewTemplateDto,
  SendTestTemplateDto,
  UpdateNotificationTemplateDto,
} from './dto/template.dto';
import type { ListTemplatesDto } from './dto/query-templates.dto';
import type { ListLogDto } from './dto/query-log.dto';
import { storeLocales } from '@common/locale';
import { resolveLocale } from '../mail/listeners/locale.util';

/** A Translatable JSONB value, draft or persisted. */
type TranslatableLike = Record<string, string | null | undefined> | string | null | undefined;

@Injectable()
export class NotificationTemplatesService {
  private readonly logger = new Logger(NotificationTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async listTemplates(query: ListTemplatesDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      ...(query.channel !== undefined && { channel: query.channel }),
      ...(query.event !== undefined && { event: query.event }),
      ...(query.isEnabled !== undefined && { isEnabled: query.isEnabled }),
    };
    const [data, total] = await Promise.all([
      this.prisma.notificationTemplate.findMany({
        where,
        orderBy: [{ channel: 'asc' }, { event: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationTemplate.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total } };
  }

  async findOne(id: string): Promise<unknown> {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException(`Template "${id}" not found`);
    return template;
  }

  async create(dto: CreateNotificationTemplateDto): Promise<unknown> {
    const existing = await this.prisma.notificationTemplate.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`Template code "${dto.code}" already in use`);

    if (dto.channel === 'email' && !dto.subject) {
      throw new BadRequestException('email templates require a subject');
    }
    if (dto.channel !== 'email' && dto.subject) {
      throw new BadRequestException(`${dto.channel} templates must not carry a subject`);
    }

    // R12: a body/subject may only reference variables the flow declares.
    this.assertTokensDeclared(
      [dto.subject as TranslatableLike, dto.body as TranslatableLike],
      dto.variables ?? [],
    );

    const template = await this.prisma.notificationTemplate.create({
      data: {
        code: dto.code,
        channel: dto.channel,
        event: dto.event,
        // Subjects are plain-text token lines — left as-is. Bodies are operator
        // rich-text: sanitize on the SAVE path (constitution §3.5) with the
        // email allowlist (keeps the inline-CSS layout, strips script/handlers).
        subject: (dto.subject as never) ?? null,
        body: sanitizeTranslatableEmailHtml(dto.body as unknown as Record<string, string>) as never,
        variables: dto.variables ?? [],
        isEnabled: dto.isEnabled ?? true,
        ...(dto.sendEnabled !== undefined && { sendEnabled: dto.sendEnabled }),
        ...(dto.category !== undefined && { category: dto.category }),
      },
    });
    this.logger.log(`create: code=${dto.code} channel=${dto.channel} event=${dto.event}`);
    this.events.emit(NOTIFICATION_TEMPLATE_CHANGED_EVENT, { code: dto.code });
    return template;
  }

  async update(id: string, dto: UpdateNotificationTemplateDto): Promise<unknown> {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Template "${id}" not found`);

    if (existing.channel !== 'email' && dto.subject) {
      throw new BadRequestException(`${existing.channel} templates must not carry a subject`);
    }

    // Non-disableable set (operator decision 2): a locked flow may be edited
    // but never switched off. The enqueue gate also refuses to skip it, so this
    // guard is the operator-facing half of the same invariant.
    if (existing.isLocked && dto.sendEnabled === false) {
      throw new BadRequestException(
        `Template "${existing.code}" is a locked security/legal flow and cannot be disabled`,
      );
    }

    // R12: validate any body/subject being written against the effective
    // declared variables (the new set if the same update expands it, else the
    // existing one). A flag-only update (sendEnabled/category) is not revalidated.
    if (dto.body !== undefined || dto.subject !== undefined) {
      const declared = dto.variables ?? (existing.variables as string[]) ?? [];
      const fields: TranslatableLike[] = [];
      if (dto.subject !== undefined) fields.push(dto.subject as TranslatableLike);
      if (dto.body !== undefined) fields.push(dto.body as TranslatableLike);
      this.assertTokensDeclared(fields, declared);
    }

    const updated = await this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(dto.subject !== undefined && { subject: dto.subject as never }),
        ...(dto.body !== undefined && {
          body: sanitizeTranslatableEmailHtml(
            dto.body as unknown as Record<string, string>,
          ) as never,
        }),
        ...(dto.variables !== undefined && { variables: dto.variables }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.sendEnabled !== undefined && { sendEnabled: dto.sendEnabled }),
        ...(dto.category !== undefined && { category: dto.category }),
      },
    });
    this.events.emit(NOTIFICATION_TEMPLATE_CHANGED_EVENT, { code: existing.code });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.notificationTemplate.findUnique({
      where: { id },
      select: { id: true, code: true },
    });
    if (!existing) throw new NotFoundException(`Template "${id}" not found`);
    await this.prisma.notificationTemplate.delete({ where: { id } });
    this.events.emit(NOTIFICATION_TEMPLATE_CHANGED_EVENT, { code: existing.code });
  }

  async listLog(query: ListLogDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Record<string, unknown> = {};
    if (query.channel !== undefined) where.channel = query.channel;
    if (query.status !== undefined) where.status = query.status;
    if (query.templateCode !== undefined) where.templateCode = query.templateCode;
    if (query.recipient !== undefined) where.recipient = query.recipient;
    if (query.from || query.to) {
      where.sentAt = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total } };
  }

  /**
   * Re-dispatch a past send. Reconstructs the original send from its
   * NotificationLog row (templateCode + locale + variables) and pushes it back
   * through the genuine `MailService.enqueue` pipeline — which re-renders, hands
   * off to BullMQ, and reconciles its own audit row. A stable `resend:<logId>`
   * dedupe key makes a double-click idempotent: the second request resolves the
   * in-flight/just-sent job instead of mailing the recipient twice.
   *
   * This module never reaches into the mail module's internals — it crosses the
   * boundary only through the injected MailService (constitution §3.1).
   */
  async resend(
    id: string,
  ): Promise<{ status: 'queued' | 'suppressed' | 'skipped'; recipient: string; logId: string }> {
    const entry = await this.prisma.notificationLog.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`Log entry "${id}" not found`);

    // Auth flows carry a single-use credential (reset / verification / magic-link
    // token). enqueue deliberately never persists it raw — `safeMetadata` redacts
    // it — so re-rendering from the stored variables would mail a broken
    // `[redacted]` link. Refuse: the recipient must request a fresh credential.
    if (entry.templateCode.startsWith('auth.')) {
      throw new BadRequestException(
        `Cannot resend "${entry.templateCode}": it carries a single-use credential — the recipient must request a new one.`,
      );
    }

    const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
    const locale: MailLocale = resolveLocale(
      typeof metadata.locale === 'string' ? metadata.locale : null,
    );
    const variables =
      metadata.variables && typeof metadata.variables === 'object'
        ? (metadata.variables as Record<string, unknown>)
        : {};

    const result = await this.mail.enqueue(entry.templateCode as MailJobName, {
      to: entry.recipient,
      locale,
      variables,
      dedupeKey: `resend:${entry.id}`,
    });

    const status = result.suppressed ? 'suppressed' : result.skipped ? 'skipped' : 'queued';
    this.logger.log(
      `resend: logId=${id} recipient=${entry.recipient} status=${status} newLogId=${result.logId}`,
    );
    // `result.logId` is the new dispatch's row; on a degenerate dedupe hit where
    // the in-flight job's payload logId is unrecoverable, fall back to the
    // original log id so the response never carries an empty id.
    return { status, recipient: entry.recipient, logId: result.logId || entry.id };
  }

  /**
   * Live-preview a DRAFT template for every enabled locale (NE6). Validates the draft's
   * tokens against the declared variables, sanitizes the body, then renders
   * through the genuine `renderDraft` pipeline — so the preview is byte-for-byte
   * what a real send would produce. Persists nothing. Omitted fields fall back
   * to the saved row.
   */
  async preview(
    id: string,
    dto: PreviewTemplateDto,
  ): Promise<Record<MailLocale, RenderedTemplate>> {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Template "${id}" not found`);

    const subject = (
      dto.subject !== undefined ? dto.subject : existing.subject
    ) as TranslatableLike;
    const rawBody = (dto.body !== undefined ? dto.body : existing.body) as TranslatableLike;
    const declared = dto.variables ?? (existing.variables as string[]) ?? [];

    this.assertTokensDeclared([subject, rawBody], declared);

    const body = sanitizeTranslatableEmailHtml(
      (rawBody ?? {}) as unknown as Record<string, string>,
    ) as unknown as TranslatableLike;
    const variables = this.buildSampleVariables(declared, dto.sampleVariables);

    const storeNameRaw = await this.settings.get<unknown>('storeName');
    return Object.fromEntries(
      (storeLocales.current().supportedLocales as readonly MailLocale[]).map((locale) => [
        locale,
        renderDraft({
          subject,
          body,
          locale,
          variables,
          storeName: resolveTranslatable(storeNameRaw, locale),
        }),
      ]),
    ) as Record<MailLocale, RenderedTemplate>;
  }

  /**
   * Send a test of this template to the requesting admin's own inbox (NE6).
   * Goes through the genuine `MailService.enqueue` pipeline (no dedupe key, so
   * the operator can re-test) and returns the honest enqueue outcome — a
   * disabled flow reports `skipped`, a suppressed recipient `suppressed`.
   */
  async sendTest(
    id: string,
    userId: string,
    dto: SendTestTemplateDto,
  ): Promise<{ status: 'queued' | 'suppressed' | 'skipped'; recipient: string; logId: string }> {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException(`Template "${id}" not found`);
    if (template.channel !== 'email') {
      throw new BadRequestException({
        error: {
          code: 'TEST_SEND_EMAIL_ONLY',
          message: `Only email templates can be test-sent (this one is "${template.channel}")`,
        },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, locale: true },
    });
    if (!user?.email) {
      throw new BadRequestException({
        error: {
          code: 'TEST_SEND_NO_RECIPIENT',
          message: 'Your account has no email address to send a test to',
        },
      });
    }

    const locale: MailLocale = resolveLocale(dto.locale ?? user.locale);
    const variables = this.buildSampleVariables(
      (template.variables as string[]) ?? [],
      dto.variables,
    );

    const result = await this.mail.enqueue(template.code as MailJobName, {
      to: user.email,
      locale,
      variables,
      // A self-test to the operator's own inbox is not customer marketing — skip
      // the NE7 consent gate so a LIFECYCLE/MARKETING template can still be
      // previewed (suppression + the kill-switch still apply).
      bypassConsent: true,
    });
    const status = result.suppressed ? 'suppressed' : result.skipped ? 'skipped' : 'queued';
    this.logger.log(
      `sendTest: code=${template.code} recipient=${user.email} status=${status} logId=${result.logId}`,
    );
    return { status, recipient: user.email, logId: result.logId };
  }

  /**
   * R12 guard: every `{{token}}` / `{{{token}}}` a subject or body references
   * must be declared in the flow's `variables`. The brand layout injects no
   * operator tokens (its chrome is literal), so the declared list is the whole
   * allowlist. Throws a stable `UNKNOWN_TEMPLATE_TOKEN` 400 otherwise.
   */
  private assertTokensDeclared(fields: TranslatableLike[], declared: string[]): void {
    const allowed = new Set(declared);
    const used = new Set<string>();
    for (const field of fields) {
      if (!field) continue;
      const values = typeof field === 'string' ? [field] : Object.values(field);
      for (const value of values) {
        if (typeof value !== 'string') continue;
        for (const token of extractTemplateTokens(value)) used.add(token);
      }
    }
    const unknown = [...used].filter((token) => !allowed.has(token));
    if (unknown.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'UNKNOWN_TEMPLATE_TOKEN',
          message: `Template references undeclared variable(s): ${unknown.join(', ')}. Add them to the flow's variables list or remove the token.`,
          details: { unknown },
        },
      });
    }
  }

  /**
   * Build a sample-variable map for preview / test-send: each declared variable
   * defaults to a visible `[name]` placeholder so the operator sees where every
   * token lands, overridden by any operator-supplied sample value.
   */
  private buildSampleVariables(
    declared: string[],
    provided?: Record<string, unknown>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of declared) out[name] = `[${name}]`;
    if (provided) {
      for (const [key, value] of Object.entries(provided)) out[key] = String(value ?? '');
    }
    return out;
  }
}
