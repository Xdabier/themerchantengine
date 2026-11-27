# themerchantengine demo API

The API behind the public demo of [themerchantengine](https://github.com/Xdabier/themerchantengine), deployed as a free Render Docker web service.

- Storefront: https://demo.themerchantengine.com
- Admin: https://demo-admin.themerchantengine.com
- The demo data is wiped and reseeded on every boot and every night at 03:00 UTC.
- Redis runs inside this container.
- The only secret is `DATABASE_URL`. Any Postgres works. Use a direct or session-mode URL (for Supabase, the session pooler on port 5432), never a transaction pooler.
- When a reseed fails, for example because the database is down or over its quota, the next try waits twice as long, up to 30 minutes.
- Health check path: `/health`. An uptime ping on it keeps the free instance awake.

## Rate limits

The port keeper in front of the API limits each visitor and the whole demo, so one busy visitor or a burst of traffic cannot use up the database quota. Over the limit, it answers 429 with a `retry-after` header.

- `DEMO_IP_BURST` (default 120) and `DEMO_IP_PER_SEC` (default 2): per visitor.
- `DEMO_ALL_BURST` (default 400) and `DEMO_ALL_PER_SEC` (default 40): for all visitors together.
- The entrypoint sets `TRUST_PROXY=loopback`, so the API's own throttle also sees each visitor's address.

## Status

`GET /status` answers `{ "data": { "state", "since", "nextResetAt" } }` with CORS open, for the "open demo" buttons.

- `state` is `booting`, `reseeding`, `db-error`, `up` or `down`.
- `up` means a catalogue read just worked, so the API and the database both answer.
- The answer is cached for 15 seconds.
