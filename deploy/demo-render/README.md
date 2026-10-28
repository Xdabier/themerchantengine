# themerchantengine demo API

The API behind the public demo of [themerchantengine](https://github.com/Xdabier/themerchantengine), deployed as a free Render Docker web service.

- Storefront: https://demo.themerchantengine.com
- Admin: https://demo-admin.themerchantengine.com
- The demo data is wiped and reseeded on every boot and every night at 03:00 UTC.
- Postgres runs on Neon. Redis runs inside this container.
- The only secret is `DATABASE_URL`, the Neon direct URL with pooling off.
- Health check path: `/health`. An uptime ping on it keeps the free instance awake.
