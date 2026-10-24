/**
 * Declarative dispatch engine — public types (NE4).
 *
 * A transactional email is now DATA: one `DispatchEntry` row binds a domain
 * event to a template via a `resolve` function. `MailDispatchListener` walks the
 * table and a shared `dispatch()` does recipient/locale resolution, stable
 * dedup-key derivation, enqueue, and the enqueue-failed audit row.
 */
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MailJobName, MailLocale } from '../mail.types';

/**
 * Read-only context handed to every resolver. Resolvers fetch recipient data
 * via the mail module's injected PrismaService — never another module's service
 * internals (constitution §3.1).
 */
export interface DispatchContext {
  prisma: PrismaService;
  config: ConfigService;
}

/**
 * What a resolver returns. `null` = skip (no recipient, anonymous actor,
 * not-applicable) — the engine enqueues nothing, replacing the listeners'
 * early-return guards.
 */
export interface DispatchResolution {
  to: string;
  locale: MailLocale;
  variables: Record<string, unknown>;
  /**
   * Stable identifier of the LOGICAL send (not merely the parent entity). The
   * engine hashes (event, dedupeId, template) into the enqueue `dedupeKey` so a
   * re-fired event never double-sends (Risk R5). Optional — a flow may omit it
   * to keep fresh-logId behaviour — but every current flow populates it.
   */
  dedupeId?: string;
}

/** One row of the declarative dispatch table: bind `event`, render `template`, via `resolve`. */
export interface DispatchEntry {
  event: string;
  template: MailJobName;
  resolve: (payload: unknown, ctx: DispatchContext) => Promise<DispatchResolution | null>;
}

/**
 * Type-safe entry builder. Lets a resolver be authored against its real
 * domain-event payload type while the table stores a uniform `DispatchEntry`.
 * The cast is localized here — event payloads are untyped at the emitter seam,
 * exactly as the removed `@OnEvent(...)` handlers declared their param type.
 */
export function dispatchEntry<P>(
  event: string,
  template: MailJobName,
  resolve: (payload: P, ctx: DispatchContext) => Promise<DispatchResolution | null>,
): DispatchEntry {
  return { event, template, resolve: (payload, ctx) => resolve(payload as P, ctx) };
}
