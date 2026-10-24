import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BotProtectionGuard } from './bot-protection.guard';
import * as turnstile from './turnstile.util';

function ctxWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/v1/newsletter/subscribe',
        ip: '1.2.3.4',
        headers,
      }),
    }),
  } as unknown as ExecutionContext;
}

function guardWith(secret?: string): BotProtectionGuard {
  const config = { get: (key: string) => (key === 'TURNSTILE_SECRET' ? secret : undefined) };
  return new BotProtectionGuard(config as unknown as ConfigService);
}

describe('BotProtectionGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('honeypot (always on)', () => {
    it('rejects a filled honeypot header even when no captcha secret is set', async () => {
      const guard = guardWith(undefined);
      await expect(guard.canActivate(ctxWithHeaders({ 'x-hp-field': 'spam' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('passes an empty honeypot when no captcha secret is set (dev/e2e open)', async () => {
      const guard = guardWith(undefined);
      await expect(guard.canActivate(ctxWithHeaders({ 'x-hp-field': '' }))).resolves.toBe(true);
    });

    it('passes a missing honeypot header when no captcha secret is set', async () => {
      const guard = guardWith(undefined);
      await expect(guard.canActivate(ctxWithHeaders({}))).resolves.toBe(true);
    });
  });

  describe('captcha (gated on TURNSTILE_SECRET)', () => {
    it('rejects when the captcha token is missing', async () => {
      const guard = guardWith('secret');
      await expect(guard.canActivate(ctxWithHeaders({ 'x-hp-field': '' }))).rejects.toMatchObject({
        response: { error: { code: 'CAPTCHA_REQUIRED' } },
      });
    });

    it('rejects when siteverify fails', async () => {
      jest.spyOn(turnstile, 'verifyTurnstileToken').mockResolvedValue(false);
      const guard = guardWith('secret');
      await expect(
        guard.canActivate(ctxWithHeaders({ 'x-captcha-response': 'bad' })),
      ).rejects.toMatchObject({ response: { error: { code: 'CAPTCHA_FAILED' } } });
    });

    it('passes when siteverify succeeds', async () => {
      const spy = jest.spyOn(turnstile, 'verifyTurnstileToken').mockResolvedValue(true);
      const guard = guardWith('secret');
      await expect(
        guard.canActivate(ctxWithHeaders({ 'x-captcha-response': 'good' })),
      ).resolves.toBe(true);
      expect(spy).toHaveBeenCalledWith('secret', 'good', '1.2.3.4');
    });

    it('rejects a filled honeypot before reaching siteverify', async () => {
      const spy = jest.spyOn(turnstile, 'verifyTurnstileToken').mockResolvedValue(true);
      const guard = guardWith('secret');
      await expect(
        guard.canActivate(ctxWithHeaders({ 'x-hp-field': 'bot', 'x-captcha-response': 'good' })),
      ).rejects.toThrow(BadRequestException);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
