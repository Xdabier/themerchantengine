// Replaces environment.ts in the `demo` build (public demo at demo-admin.themerchantengine.com).
export const environment = {
  production: false,
  apiBaseUrl: '/api',
  sentryDsn: null as string | null,
  demoLogin: { email: 'demo@themerchantengine.com', password: 'demo-admin-2026' } as {
    email: string;
    password: string;
  } | null,
};
