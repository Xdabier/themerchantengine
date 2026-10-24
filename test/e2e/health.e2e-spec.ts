import { api } from './helpers';

/**
 * Plan E / Phase E7 — `GET /health` envelope (finding E10).
 *
 * The controller wrapped its payload in `data` by hand and the global
 * `ApiResponseInterceptor` wrapped it again, so the endpoint answered
 * `{ data: { data: { status } } }` while its own Swagger example documented
 * the single-wrapped shape. Every consumer (Dockerfile healthcheck, CI wait
 * loop, deploy scripts, e2e setups, prod-verify) checks the status code only,
 * so unwrapping is safe.
 */
describe('GET /health', () => {
  it('answers 200 with a single-wrapped envelope', async () => {
    const res = await api().get('/health').expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe('ok');
    expect(Number.isNaN(Date.parse(res.body.data.timestamp))).toBe(false);
  });

  it('does not double-wrap the payload', async () => {
    const res = await api().get('/health').expect(200);

    expect(res.body.data.data).toBeUndefined();
  });
});
