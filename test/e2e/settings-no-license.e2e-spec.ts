/**
 * License enforcement is gone (DR-35). Pins that the license routes no longer
 * exist, that the settings read carries no `license` group, and that the old
 * verdict keys are refused as unknown settings keys.
 *
 * Real dockerized DB per constitution §3.8; nothing here writes.
 */
import { ADMIN, api, loginAs } from './helpers';

describe('settings without a license group (DR-35)', () => {
  let adminCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  });

  it('has no license verdict route', async () => {
    await api().get('/v1/admin/license').set('Cookie', adminCookie).expect(404);
  });

  it('has no license install route', async () => {
    await api().post('/v1/admin/license/install').set('Cookie', adminCookie).expect(404);
  });

  it('reads settings with no license group', async () => {
    const res = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);
    expect(res.body.data).not.toHaveProperty('license');
  });

  it('refuses the old verdict keys as unknown settings keys', async () => {
    const res = await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ status: 'valid', claims: { plan: 'forged' }, verifiedAt: '2026-01-01T00:00:00.000Z' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
