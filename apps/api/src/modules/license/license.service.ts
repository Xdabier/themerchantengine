import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProduction } from '@common/env';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { hostOf, missingVerdict, verifyLicenseFile, type LicenseVerdict } from '@common/license';
import { SettingsService } from '../settings/settings.service';
import {
  LICENSE_FILE_ENV,
  LICENSE_PUBLIC_KEY_ENV,
  LICENSE_PUBLIC_KEY_PEM,
} from './license.constants';

// The pure verification and the domain helpers live in `@common/license`,
// shared with the install stepper; they are re-exported here for the callers
// and the specs that reach them through this module.
export { hostOf, isBound } from '@common/license';

/** The variables that carry the public origins this deployment answers on. */
const DOMAIN_ENV_KEYS = [
  'STOREFRONT_PUBLIC_BASE_URL',
  'ADMIN_PUBLIC_BASE_URL',
  'API_PUBLIC_BASE_URL',
] as const;

/**
 * Verifies the offline license file at boot (DR-31, plan E1.5).
 *
 * The file is JSON `{ claims, signature }`. The signature is Ed25519 over the
 * canonical JSON of the claims, checked against the public key baked into the
 * engine. The bound domains are checked against the public origins the
 * deployment answers on (the `*_PUBLIC_BASE_URL` variables). The verdict is written to the `license` settings group, which is
 * what `GET /v1/admin/license` and the admin banner read.
 *
 * Boot policy:
 * - a bad signature, unparseable claims or a domain mismatch stop the process
 *   with one clear message, in every environment;
 * - no file is never fatal (DR-34): it is reported as `missing` on the banner,
 *   and production also logs a warning at boot;
 * - expiry never cuts anything: `expiring` before the date, `grace` for
 *   `LICENSE_GRACE_DAYS` after it, then `expired`, all banner states only.
 */
@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger(LicenseService.name);
  private verdict: LicenseVerdict | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.overrideAllowed() && this.config.get<string>(LICENSE_PUBLIC_KEY_ENV)) {
      // `publicKey()` already ignores the override outside test and
      // development, so this throw changes no verification outcome. It exists
      // so an operator who set the variable expecting it to work is told, at
      // boot, that it did nothing, rather than discovering it through a
      // license that refuses to verify.
      throw new Error(
        `${LICENSE_PUBLIC_KEY_ENV} is set outside test and development; the engine only trusts its baked key.`,
      );
    }
    const verdict = await this.verifyInstalled();
    await this.persist(verdict);
    this.verdict = verdict;
    if (verdict.status === 'invalid') {
      throw new Error(`License check failed: ${verdict.reason}. The API refuses to start.`);
    }
    if (verdict.status === 'missing' && isProduction(this.config)) {
      this.logger.warn(
        `The API runs unlicensed: ${verdict.reason}. Set ${LICENSE_FILE_ENV} to the path of a readable license file issued for this store.`,
      );
      return;
    }
    this.logger.log(
      `License status: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`,
    );
  }

  /** The verdict reached at boot; re-verified when a caller asks for a fresh one. */
  async current(fresh = false): Promise<LicenseVerdict> {
    if (this.verdict && !fresh) return this.verdict;
    this.verdict = await this.verifyInstalled();
    await this.persist(this.verdict);
    return this.verdict;
  }

  /**
   * Verifies an operator-supplied license file and, only if it verifies,
   * writes it to the configured `LICENSE_FILE` path (plan E3.5.4).
   *
   * The order is the whole security property: verify against the baked key and
   * the configured origins first, write second. Nothing here trusts a path
   * from the caller, and nothing accepts a key from the caller; the only input
   * is the file's bytes.
   *
   * The write is a temp file and a rename rather than a truncate in place. A
   * crash midway through overwriting the license would leave a half-written
   * file, and a half-written file is `invalid`, which in production stops the
   * API from starting on its next boot. A rename either happens or does not.
   */
  async install(content: string, now: Date = new Date()): Promise<LicenseVerdict> {
    const file = this.config.get<string>(LICENSE_FILE_ENV);
    if (!file) {
      throw new BadRequestException({
        error: {
          code: 'LICENSE_FILE_NOT_CONFIGURED',
          message: `this engine has no ${LICENSE_FILE_ENV} path configured, so there is nowhere to install a license`,
        },
      });
    }

    const verdict = this.verify(content, this.configuredHosts(), now);
    if (verdict.status === 'invalid' || verdict.status === 'missing') {
      throw new BadRequestException({
        error: {
          code: 'LICENSE_REFUSED',
          message: verdict.reason ?? 'this license file did not verify',
        },
      });
    }

    // Unique per attempt, rather than one shared scratch name.
    //
    // Two installs cannot interleave inside one process: everything from the
    // verify to the rename is synchronous, so the event loop never yields in
    // the middle. Two processes sharing the path can, which is a second API
    // replica or a container restarting onto the same volume, and there the
    // shared scratch name lets two writes mix into a file that is neither
    // caller's. The rename then publishes it, and a malformed license is not a
    // bad request: it is an API that refuses to start on its next boot.
    const temp = scratchPathFor(file);
    try {
      fs.writeFileSync(temp, content, 'utf8');
      fs.renameSync(temp, file);
    } catch (err) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // Nothing to recover: the install failed and the previous file stands.
      }
      // The errno, never the message: Node puts the absolute path in the text,
      // and the operator needs to know it was a permission, a full disk or a
      // read-only mount, not where the engine keeps its license.
      const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      this.logger.error(`License write failed at ${file}: ${(err as Error).message}`);
      throw new BadRequestException({
        error: {
          code: 'LICENSE_WRITE_FAILED',
          message: `the license verified but could not be written (${code})`,
        },
      });
    }

    this.verdict = verdict;
    await this.persist(verdict);
    this.logger.log(`License replaced. Status: ${verdict.status}`);
    return verdict;
  }

  /** Reads `LICENSE_FILE` and verifies it against the configured domains. */
  async verifyInstalled(now: Date = new Date()): Promise<LicenseVerdict> {
    const file = this.config.get<string>(LICENSE_FILE_ENV);
    if (!file) return missingVerdict('no license file configured', now);
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      this.logger.debug(`License file ${file} cannot be read: ${(err as Error).message}`);
      return missingVerdict('the configured license file cannot be read', now);
    }
    return this.verify(content, this.configuredHosts(), now);
  }

  /**
   * Verification of one file's content against the trusted key and the
   * store's configured hosts. The logic is `verifyLicenseFile` in the shared
   * library, which the install stepper runs before it writes anything, so the
   * two cannot disagree about a file (§3.14).
   */
  verify(
    content: string,
    configuredHosts: readonly string[],
    now: Date = new Date(),
  ): LicenseVerdict {
    return verifyLicenseFile(content, configuredHosts, this.publicKeyPem(), now);
  }

  /**
   * The key this engine trusts.
   *
   * An allow-list, not a deny-list, and enforced here at the read rather than
   * only at boot. The previous shape refused the environment override when
   * `NODE_ENV` was exactly `production`, which meant it was honoured under
   * `staging`, `prod`, `Production` and an unset variable alike. Nothing
   * validates or defaults `NODE_ENV`, and the party who sets it is the
   * licensee, so that guard handed the trust root to whoever starts the
   * container: mint a keypair, sign any claims, set two variables.
   *
   * The override exists for the test suites, which verify fixtures signed by
   * the test key whose public half is in `test/fixtures/license/`. Only `test` and `development`
   * get it. Every other label, including none at all, gets the baked key.
   */
  private publicKeyPem(): string {
    return this.overrideAllowed() ? this.overrideKey() : LICENSE_PUBLIC_KEY_PEM;
  }

  private overrideAllowed(): boolean {
    return !isProduction(this.config);
  }

  private overrideKey(): string {
    return this.config.get<string>(LICENSE_PUBLIC_KEY_ENV) || LICENSE_PUBLIC_KEY_PEM;
  }

  /**
   * Hostnames of the public origins the deployment serves, from the
   * environment only. The `domains` settings rows are editable over HTTP by
   * an admin; binding the boot check to them would let one settings edit stop
   * every later restart (security review H3). The environment is what the
   * deploy actually answers on, and only the operator changes it.
   */
  private configuredHosts(): string[] {
    const hosts = new Set<string>();
    for (const name of DOMAIN_ENV_KEYS) {
      const host = hostOf(this.config.get<string>(name) ?? '');
      if (host) hosts.add(host);
    }
    return [...hosts];
  }

  /** Writes the verdict only when it differs from the stored one: every boot verifies, few change anything. */
  private async persist(verdict: LicenseVerdict): Promise<void> {
    try {
      const stored = await this.settings.readLicenseVerdict();
      const same =
        stored.status === verdict.status &&
        JSON.stringify(stored.claims ?? null) === JSON.stringify(verdict.claims ?? null);
      if (same) return;
      await this.settings.writeLicenseVerdict({
        status: verdict.status,
        claims: verdict.claims,
        verifiedAt: verdict.verifiedAt,
      });
    } catch (err) {
      // The verdict still governs boot; a settings write failure must not
      // hide it, and the banner re-reads on the next request.
      this.logger.warn(`Could not persist the license verdict: ${(err as Error).message}`);
    }
  }
}

/**
 * A scratch path for one install attempt, unique per call.
 *
 * Not a single `${file}.incoming`. Two installs cannot interleave inside one
 * process, because everything from the verify to the rename is synchronous and
 * the event loop never yields in the middle. Two processes sharing the path
 * can, which is a second API replica or a container restarting onto the same
 * volume, and there one scratch name lets two writes mix into a file that is
 * neither caller's. The rename then publishes it, and a malformed license is
 * not a bad request: it is an API that refuses to start on its next boot.
 */
export function scratchPathFor(file: string): string {
  return `${file}.incoming.${randomUUID()}`;
}
