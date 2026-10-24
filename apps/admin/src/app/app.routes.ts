import { Route } from '@angular/router';
import { authGuard, guestOnlyGuard, permissionGuard } from './core/guards';

/**
 * Top-level route table. Authenticated routes live under AppShell; guest-only
 * auth routes live under AuthLayout (rendered directly as full-screen pages).
 */
export const appRoutes: Route[] = [
  {
    path: 'auth',
    loadComponent: () =>
      import('./shared/layouts/auth-layout.component').then((m) => m.AuthLayoutComponent),
    children: [
      {
        path: 'login',
        canActivate: [guestOnlyGuard],
        loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
        data: { title: 'Sign in' },
      },
      {
        path: 'forgot',
        canActivate: [guestOnlyGuard],
        loadComponent: () =>
          import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
        data: { title: 'Forgot password' },
      },
      {
        path: 'reset',
        canActivate: [guestOnlyGuard],
        loadComponent: () =>
          import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
        data: { title: 'Reset password' },
      },
      {
        // No guest-only guard: the 2FA challenge is a transient mid-sign-in
        // step — the operator is not yet authenticated when they reach it.
        path: 'two-factor',
        loadComponent: () =>
          import('./features/auth/two-factor-challenge.page').then((m) => m.TwoFactorChallengePage),
        data: { title: 'Two-factor authentication' },
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },
  {
    // Email-verification landing — Better Auth redirects the browser here
    // after the verify-email endpoint runs. Reachable authed or anonymous,
    // so it sits outside the guest-only `auth` group.
    path: 'verify-email',
    loadComponent: () => import('./features/auth/verify-email.page').then((m) => m.VerifyEmailPage),
    data: { title: 'Verify email' },
  },
  {
    path: '403',
    loadComponent: () => import('./shared/errors/forbidden.page').then((m) => m.ForbiddenPage),
    data: { title: 'Access denied' },
  },
  {
    path: '500',
    loadComponent: () => import('./shared/errors/server-error.page').then((m) => m.ServerErrorPage),
    data: { title: 'Server error' },
  },
  {
    path: '404',
    loadComponent: () => import('./shared/errors/not-found.page').then((m) => m.NotFoundPage),
    data: { title: 'Not found' },
  },
  {
    path: 'dev/design-system',
    loadComponent: () =>
      import('./dev/design-system/design-system.page').then((m) => m.DesignSystemPage),
    data: { title: 'Design System' },
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () => import('./shared/layouts/app-shell.component').then((m) => m.AppShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
        data: { title: 'Dashboard' },
      },
      {
        path: 'dev/asset-picker',
        loadComponent: () =>
          import('./dev/asset-picker/asset-picker-host.page').then((m) => m.AssetPickerHostPage),
        data: { title: 'Asset picker (dev)' },
      },
      {
        path: 'analytics',
        canActivate: [permissionGuard('analytics:view')],
        data: { title: 'Analytics', permission: 'analytics:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/analytics/analytics-hub.page').then((m) => m.AnalyticsHubPage),
          },
          {
            path: 'funnel',
            data: { title: 'Conversion funnel' },
            loadComponent: () =>
              import('./features/analytics/funnel.page').then((m) => m.AnalyticsFunnelPage),
          },
          {
            path: 'products',
            data: { title: 'Product performance' },
            loadComponent: () =>
              import('./features/analytics/products.page').then((m) => m.AnalyticsProductsPage),
          },
          {
            path: 'revenue',
            data: { title: 'Revenue' },
            loadComponent: () =>
              import('./features/analytics/revenue.page').then((m) => m.AnalyticsRevenuePage),
          },
          {
            path: 'customers',
            data: { title: 'Customer analytics' },
            loadComponent: () =>
              import('./features/analytics/customers.page').then((m) => m.AnalyticsCustomersPage),
          },
          {
            path: 'search',
            data: { title: 'Search analytics' },
            loadComponent: () =>
              import('./features/analytics/search.page').then((m) => m.AnalyticsSearchPage),
          },
          {
            path: 'pixels',
            canActivate: [permissionGuard('analytics:manage')],
            data: { title: 'Tracking pixels', permission: 'analytics:manage' },
            loadComponent: () =>
              import('./features/analytics/pixels.page').then((m) => m.AnalyticsPixelsPage),
          },
        ],
      },
      {
        path: 'orders',
        canActivate: [permissionGuard('orders:view')],
        data: { title: 'Orders', permission: 'orders:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/orders/orders-list.page').then((m) => m.OrdersListPage),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('orders:create')],
            data: { title: 'New order', permission: 'orders:create' },
            loadComponent: () =>
              import('./features/orders/order-new.page').then((m) => m.OrderNewPage),
          },
          {
            path: ':id/edit',
            canActivate: [permissionGuard('orders:update')],
            data: { title: 'Edit order', permission: 'orders:update' },
            loadComponent: () =>
              import('./features/orders/order-edit.page').then((m) => m.OrderEditPage),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/orders/order-detail.page').then((m) => m.OrderDetailPage),
          },
        ],
      },
      {
        path: 'categories',
        canActivate: [permissionGuard('categories:view')],
        data: { title: 'Categories', permission: 'categories:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/categories/categories-tree.page').then(
                (m) => m.CategoriesTreePage,
              ),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('categories:create')],
            loadComponent: () =>
              import('./features/categories/category-form.page').then((m) => m.CategoryFormPage),
            data: { title: 'New category' },
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/categories/category-form.page').then((m) => m.CategoryFormPage),
          },
        ],
      },
      {
        path: 'promotions',
        canActivate: [permissionGuard('promotions:view')],
        data: { title: 'Promotions', permission: 'promotions:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/promotions/promotions-list.page').then(
                (m) => m.PromotionsListPage,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/promotions/promotion-detail.page').then(
                (m) => m.PromotionDetailPage,
              ),
          },
        ],
      },
      {
        path: 'gift-cards',
        canActivate: [permissionGuard('gift_cards:view')],
        data: { title: 'Gift cards', permission: 'gift_cards:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/gift-cards/gift-cards-list.page').then((m) => m.GiftCardsListPage),
          },
          {
            path: 'issue',
            canActivate: [permissionGuard('gift_cards:create')],
            loadComponent: () =>
              import('./features/gift-cards/gift-card-issue.page').then((m) => m.GiftCardIssuePage),
            data: { title: 'Issue gift card' },
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/gift-cards/gift-card-detail.page').then(
                (m) => m.GiftCardDetailPage,
              ),
          },
        ],
      },
      {
        path: 'customers',
        canActivate: [permissionGuard('customers:view')],
        data: { title: 'Customers', permission: 'customers:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/users/customers-list.page').then((m) => m.CustomersListPage),
          },
          {
            path: 'segments',
            data: { title: 'Customer segments', permission: 'customers:view' },
            loadComponent: () =>
              import('./features/users/customer-segments.page').then((m) => m.CustomerSegmentsPage),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/users/customer-detail.page').then((m) => m.CustomerDetailPage),
          },
        ],
      },
      {
        path: 'staff',
        canActivate: [permissionGuard('admin_users:view')],
        data: { title: 'Staff', permission: 'admin_users:view' },
        loadComponent: () =>
          import('./features/users/staff-list.page').then((m) => m.StaffListPage),
      },
      {
        path: 'roles',
        canActivate: [permissionGuard('admin_users:view')],
        data: { title: 'Roles', permission: 'admin_users:view' },
        loadComponent: () => import('./features/users/roles.page').then((m) => m.RolesPage),
      },
      {
        path: 'settings',
        canActivate: [permissionGuard('settings:view')],
        data: { title: 'Settings', permission: 'settings:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/settings/settings-home.page').then((m) => m.SettingsHomePage),
          },
          {
            path: 'general',
            loadComponent: () =>
              import('./features/settings/settings-general.page').then(
                (m) => m.SettingsGeneralPage,
              ),
            data: { title: 'General' },
          },
          {
            path: 'locales',
            loadComponent: () =>
              import('./features/settings/settings-locales.page').then(
                (m) => m.SettingsLocalesPage,
              ),
            data: { title: 'Locales' },
          },
          {
            path: 'brand',
            loadComponent: () =>
              import('./features/settings/settings-brand.page').then((m) => m.SettingsBrandPage),
            data: { title: 'Brand' },
          },
          {
            path: 'money',
            loadComponent: () =>
              import('./features/settings/settings-money.page').then((m) => m.SettingsMoneyPage),
            data: { title: 'Money' },
          },
          {
            path: 'domains',
            loadComponent: () =>
              import('./features/settings/settings-domains.page').then(
                (m) => m.SettingsDomainsPage,
              ),
            data: { title: 'Domains' },
          },
          {
            path: 'appearance',
            loadComponent: () =>
              import('./features/settings/settings-appearance.page').then(
                (m) => m.SettingsAppearancePage,
              ),
            data: { title: 'Appearance' },
          },
          {
            path: 'license',
            canActivate: [permissionGuard('license:view')],
            loadComponent: () =>
              import('./features/settings/settings-license.page').then(
                (m) => m.SettingsLicensePage,
              ),
            data: { title: 'License', permission: 'license:view' },
          },
          {
            path: 'integrations',
            canActivate: [permissionGuard('settings:manage')],
            loadComponent: () =>
              import('./features/settings/settings-integrations.page').then(
                (m) => m.SettingsIntegrationsPage,
              ),
            data: { title: 'Integrations', permission: 'settings:manage' },
          },
          {
            path: 'product-types',
            canActivate: [permissionGuard('products:view')],
            data: { title: 'Product types', permission: 'products:view' },
            loadComponent: () =>
              import('./features/products/product-types-list.page').then(
                (m) => m.ProductTypesListPage,
              ),
          },
          {
            path: 'attributes',
            canActivate: [permissionGuard('products:view')],
            data: { title: 'Attributes', permission: 'products:view' },
            loadComponent: () =>
              import('./features/products/attributes-list.page').then((m) => m.AttributesListPage),
          },
        ],
      },
      {
        path: 'currencies',
        canActivate: [permissionGuard('settings:view')],
        data: { title: 'Currencies', permission: 'settings:view' },
        loadComponent: () =>
          import('./features/currencies/currencies.page').then((m) => m.CurrenciesPage),
      },
      {
        path: 'assets',
        canActivate: [permissionGuard('assets:view')],
        data: { title: 'Assets', permission: 'assets:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/assets/assets-library.page').then((m) => m.AssetsLibraryPage),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/assets/asset-detail.page').then((m) => m.AssetDetailPage),
          },
        ],
      },
      {
        path: 'me',
        data: { title: 'My profile' },
        loadComponent: () => import('./features/account/me.page').then((m) => m.MePage),
      },
      {
        path: 'me/security',
        data: { title: 'Two-factor authentication' },
        loadComponent: () =>
          import('./features/auth/two-factor-setup.page').then((m) => m.TwoFactorSetupPage),
      },
      {
        path: 'audit-logs',
        canActivate: [permissionGuard('audit_log:view')],
        data: { title: 'Audit logs', permission: 'audit_log:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/audit-logs/audit-logs.page').then((m) => m.AuditLogsPage),
          },
          {
            path: ':entityType/:entityId',
            data: { title: 'Audit log entity' },
            loadComponent: () =>
              import('./features/audit-logs/audit-log-entity.page').then(
                (m) => m.AuditLogEntityPage,
              ),
          },
        ],
      },
      {
        path: 'shipping',
        canActivate: [permissionGuard('settings:view')],
        data: { title: 'Shipping' },
        children: [
          {
            path: 'carriers',
            canActivate: [permissionGuard('carriers:view')],
            data: { title: 'Carriers', permission: 'carriers:view' },
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/shipping/carriers-list.page').then((m) => m.CarriersListPage),
              },
              {
                path: 'new',
                canActivate: [permissionGuard('carriers:create')],
                data: { title: 'New carrier', permission: 'carriers:create' },
                loadComponent: () =>
                  import('./features/shipping/carrier-new.page').then((m) => m.CarrierNewPage),
              },
              {
                path: ':id',
                loadComponent: () =>
                  import('./features/shipping/carrier-detail.page').then(
                    (m) => m.CarrierDetailPage,
                  ),
              },
            ],
          },
          {
            path: 'zones',
            canActivate: [permissionGuard('shipping:view')],
            data: { title: 'Shipping zones', permission: 'shipping:view' },
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/shipping/zones-list.page').then(
                    (m) => m.ShippingZonesListPage,
                  ),
              },
              {
                path: 'new',
                canActivate: [permissionGuard('shipping:create')],
                data: { title: 'New shipping zone', permission: 'shipping:create' },
                loadComponent: () =>
                  import('./features/shipping/zone-editor.page').then(
                    (m) => m.ShippingZoneEditorPage,
                  ),
              },
              {
                path: ':id/edit',
                canActivate: [permissionGuard('shipping:update')],
                data: { title: 'Edit shipping zone', permission: 'shipping:update' },
                loadComponent: () =>
                  import('./features/shipping/zone-editor.page').then(
                    (m) => m.ShippingZoneEditorPage,
                  ),
              },
            ],
          },
          {
            path: 'methods',
            canActivate: [permissionGuard('shipping:view')],
            data: { title: 'Shipping methods', permission: 'shipping:view' },
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/shipping/methods-list.page').then(
                    (m) => m.ShippingMethodsListPage,
                  ),
              },
              {
                path: 'new',
                canActivate: [permissionGuard('shipping:create')],
                data: { title: 'New shipping method', permission: 'shipping:create' },
                loadComponent: () =>
                  import('./features/shipping/method-editor.page').then(
                    (m) => m.ShippingMethodEditorPage,
                  ),
              },
              {
                path: ':id/edit',
                canActivate: [permissionGuard('shipping:update')],
                data: { title: 'Edit shipping method', permission: 'shipping:update' },
                loadComponent: () =>
                  import('./features/shipping/method-editor.page').then(
                    (m) => m.ShippingMethodEditorPage,
                  ),
              },
              {
                path: ':id',
                data: { title: 'Shipping method' },
                loadComponent: () =>
                  import('./features/shipping/method-detail.page').then(
                    (m) => m.ShippingMethodDetailPage,
                  ),
              },
            ],
          },
          {
            path: 'countries',
            canActivate: [permissionGuard('settings:view')],
            data: { title: 'Countries', permission: 'settings:view' },
            loadComponent: () =>
              import('./features/shipping/countries.page').then((m) => m.CountriesPage),
          },
          {
            path: 'tax',
            canActivate: [permissionGuard('settings:view')],
            data: { title: 'Tax zones', permission: 'settings:view' },
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/shipping/tax/tax-zones-list.page').then(
                    (m) => m.TaxZonesListPage,
                  ),
              },
              {
                path: 'zones/new',
                canActivate: [permissionGuard('settings:manage')],
                data: { title: 'New tax zone', permission: 'settings:manage' },
                loadComponent: () =>
                  import('./features/shipping/tax/tax-zone-new.page').then((m) => m.TaxZoneNewPage),
              },
              {
                path: 'classes',
                canActivate: [permissionGuard('settings:view')],
                data: { title: 'Tax classes', permission: 'settings:view' },
                loadComponent: () =>
                  import('./features/shipping/tax/tax-classes-list.page').then(
                    (m) => m.TaxClassesListPage,
                  ),
              },
              {
                path: 'classes/new',
                canActivate: [permissionGuard('settings:manage')],
                data: { title: 'New tax class', permission: 'settings:manage' },
                loadComponent: () =>
                  import('./features/shipping/tax/tax-class-new.page').then(
                    (m) => m.TaxClassNewPage,
                  ),
              },
              {
                path: ':id',
                loadComponent: () =>
                  import('./features/shipping/tax/tax-zone-editor.page').then(
                    (m) => m.TaxZoneEditorPage,
                  ),
              },
            ],
          },
        ],
      },
      {
        path: 'payment-methods',
        canActivate: [permissionGuard('payment_methods:view')],
        data: { title: 'Payment methods', permission: 'payment_methods:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/payments/payment-methods-list.page').then(
                (m) => m.PaymentMethodsListPage,
              ),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('payment_methods:create')],
            data: { title: 'New payment method', permission: 'payment_methods:create' },
            loadComponent: () =>
              import('./features/payments/payment-method-new.page').then(
                (m) => m.PaymentMethodNewPage,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/payments/payment-method-detail.page').then(
                (m) => m.PaymentMethodDetailPage,
              ),
          },
        ],
      },
      {
        path: 'search',
        canActivate: [permissionGuard('search:view')],
        data: { title: 'Search', permission: 'search:view' },
        loadComponent: () =>
          import('./features/search/search-results.page').then((m) => m.SearchResultsPage),
      },
      {
        path: 'search-ops',
        canActivate: [permissionGuard('products:update')],
        data: { title: 'Search ops', permission: 'products:update' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            data: { title: 'Search ops' },
            loadComponent: () =>
              import('./features/search-ops/search-ops-hub.page').then((m) => m.SearchOpsHubPage),
          },
          {
            path: 'synonyms',
            data: { title: 'Synonyms' },
            loadComponent: () =>
              import('./features/search-ops/synonyms-list.page').then((m) => m.SynonymsListPage),
          },
          {
            path: 'merchandising',
            data: { title: 'Merchandising' },
            loadComponent: () =>
              import('./features/search-ops/merchandising-list.page').then(
                (m) => m.MerchandisingListPage,
              ),
          },
          {
            path: 'zero-results',
            data: { title: 'Zero-result queries' },
            loadComponent: () =>
              import('./features/search-ops/zero-results.page').then((m) => m.ZeroResultsPage),
          },
        ],
      },
      {
        path: 'notifications',
        canActivate: [permissionGuard('notifications:view')],
        data: { title: 'Notifications', permission: 'notifications:view' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'inbox' },
          {
            path: 'inbox',
            data: { title: 'Inbox' },
            loadComponent: () =>
              import('./features/notifications/inbox.page').then((m) => m.InboxPage),
          },
          {
            path: 'templates',
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/notifications/templates-list.page').then(
                    (m) => m.TemplatesListPage,
                  ),
              },
              {
                path: 'new',
                canActivate: [permissionGuard('notifications:manage')],
                data: { title: 'New template', permission: 'notifications:manage' },
                loadComponent: () =>
                  import('./features/notifications/template-editor.page').then(
                    (m) => m.TemplateEditorPage,
                  ),
              },
              {
                path: ':id',
                canActivate: [permissionGuard('notifications:manage')],
                data: { title: 'Edit template', permission: 'notifications:manage' },
                loadComponent: () =>
                  import('./features/notifications/template-editor.page').then(
                    (m) => m.TemplateEditorPage,
                  ),
              },
            ],
          },
          {
            path: 'log',
            data: { title: 'Send log' },
            loadComponent: () =>
              import('./features/notifications/log-list.page').then((m) => m.LogListPage),
          },
        ],
      },
      {
        path: 'campaigns',
        canActivate: [permissionGuard('campaigns:view')],
        data: { title: 'Campaigns', permission: 'campaigns:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/campaigns/campaigns-list.page').then((m) => m.CampaignsListPage),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('campaigns:create')],
            data: { title: 'New campaign', permission: 'campaigns:create' },
            loadComponent: () =>
              import('./features/campaigns/campaign-editor.page').then((m) => m.CampaignEditorPage),
          },
          {
            path: ':id',
            canActivate: [permissionGuard('campaigns:view')],
            data: { title: 'Edit campaign', permission: 'campaigns:view' },
            loadComponent: () =>
              import('./features/campaigns/campaign-editor.page').then((m) => m.CampaignEditorPage),
          },
        ],
      },
      {
        path: 'subscribers',
        canActivate: [permissionGuard('campaigns:view')],
        data: { title: 'Subscribers', permission: 'campaigns:view' },
        loadComponent: () =>
          import('./features/campaigns/subscribers-list.page').then((m) => m.SubscribersListPage),
      },
      {
        path: 'checkout-settings',
        canActivate: [permissionGuard('checkout:view')],
        data: { title: 'Checkout settings', permission: 'checkout:view' },
        loadComponent: () =>
          import('./features/payments/checkout-settings.page').then((m) => m.CheckoutSettingsPage),
      },
      {
        path: 'returns',
        canActivate: [permissionGuard('returns:view')],
        data: { title: 'Returns', permission: 'returns:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/returns/returns-list.page').then((m) => m.ReturnsListPage),
          },
          {
            path: ':id',
            data: { title: 'Return detail', permission: 'returns:view' },
            loadComponent: () =>
              import('./features/returns/return-detail.page').then((m) => m.ReturnDetailPage),
          },
        ],
      },
      {
        // The module, the permission, the entity numbers and every status word
        // say "return"; refund is one step of that flow. Bookmarks survive.
        path: 'refunds',
        pathMatch: 'prefix',
        redirectTo: 'returns',
      },
      {
        path: 'reviews',
        canActivate: [permissionGuard('reviews:view')],
        data: { title: 'Reviews', permission: 'reviews:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/reviews/reviews-list.page').then((m) => m.ReviewsListPage),
          },
          {
            path: ':id',
            data: { title: 'Review detail', permission: 'reviews:view' },
            loadComponent: () =>
              import('./features/reviews/review-detail.page').then((m) => m.ReviewDetailPage),
          },
        ],
      },
      {
        path: 'questions',
        canActivate: [permissionGuard('reviews:view')],
        data: { title: 'Questions', permission: 'reviews:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/reviews/questions-list.page').then((m) => m.QuestionsListPage),
          },
          {
            path: ':id',
            data: { title: 'Question detail', permission: 'reviews:view' },
            loadComponent: () =>
              import('./features/reviews/question-detail.page').then((m) => m.QuestionDetailPage),
          },
        ],
      },
      {
        path: 'seo',
        canActivate: [permissionGuard('seo:view')],
        data: { title: 'SEO', permission: 'seo:view' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'indexing' },
          {
            path: 'indexing',
            data: { title: 'Indexing', permission: 'seo:view' },
            loadComponent: () =>
              import('./features/seo/seo-submissions.page').then((m) => m.SeoSubmissionsPage),
          },
          {
            path: 'redirects',
            data: { title: 'Redirects', permission: 'seo:view' },
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/seo/seo-redirects-list.page').then(
                    (m) => m.SeoRedirectsListPage,
                  ),
              },
              {
                path: 'new',
                canActivate: [permissionGuard('seo:create')],
                data: { title: 'New redirect', permission: 'seo:create' },
                loadComponent: () =>
                  import('./features/seo/seo-redirect-new.page').then((m) => m.SeoRedirectNewPage),
              },
            ],
          },
          {
            path: 'health',
            data: { title: 'SEO health', permission: 'seo:view' },
            loadComponent: () =>
              import('./features/seo/seo-health.page').then((m) => m.SeoHealthPage),
          },
        ],
      },
      {
        path: 'pages',
        canActivate: [permissionGuard('cms:view')],
        data: { title: 'Pages', permission: 'cms:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/cms/pages-list.page').then((m) => m.CmsPagesListPage),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('cms:create')],
            data: { title: 'New page', permission: 'cms:create' },
            loadComponent: () =>
              import('./features/cms/page-editor.page').then((m) => m.CmsPageEditorPage),
          },
          {
            path: ':id/edit',
            canActivate: [permissionGuard('cms:update')],
            data: { title: 'Edit page', permission: 'cms:update' },
            loadComponent: () =>
              import('./features/cms/page-editor.page').then((m) => m.CmsPageEditorPage),
          },
        ],
      },
      {
        path: 'webhooks',
        canActivate: [permissionGuard('settings:view')],
        data: { title: 'Webhooks', permission: 'settings:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/webhooks/webhooks-list.page').then((m) => m.WebhooksListPage),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('settings:manage')],
            data: { title: 'New webhook', permission: 'settings:manage' },
            loadComponent: () =>
              import('./features/webhooks/webhook-create.page').then((m) => m.WebhookCreatePage),
          },
          {
            path: ':id',
            pathMatch: 'full',
            data: { title: 'Webhook', permission: 'settings:view' },
            loadComponent: () =>
              import('./features/webhooks/webhook-detail.page').then((m) => m.WebhookDetailPage),
          },
          {
            path: ':id/edit',
            canActivate: [permissionGuard('settings:manage')],
            data: { title: 'Edit webhook', permission: 'settings:manage' },
            loadComponent: () =>
              import('./features/webhooks/webhook-edit.page').then((m) => m.WebhookEditPage),
          },
        ],
      },
      {
        path: 'products',
        canActivate: [permissionGuard('products:view')],
        data: { title: 'Products', permission: 'products:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/products/products-list.page').then((m) => m.ProductsListPage),
          },
          {
            path: 'new',
            canActivate: [permissionGuard('products:create')],
            data: { title: 'New product', permission: 'products:create' },
            loadComponent: () =>
              import('./features/products/product-create.page').then((m) => m.ProductCreatePage),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/products/product-detail.page').then((m) => m.ProductDetailPage),
          },
          {
            path: ':id/edit',
            canActivate: [permissionGuard('products:update')],
            data: { title: 'Edit product', permission: 'products:update' },
            loadComponent: () =>
              import('./features/products/product-edit.page').then((m) => m.ProductEditPage),
          },
        ],
      },
      {
        path: 'inventory',
        canActivate: [permissionGuard('inventory:view')],
        data: { title: 'Inventory', permission: 'inventory:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/inventory/inventory-stock-list.page').then(
                (m) => m.InventoryStockListPage,
              ),
          },
          {
            path: 'alerts',
            data: { title: 'Stock alerts' },
            loadComponent: () =>
              import('./features/inventory/inventory-alerts-list.page').then(
                (m) => m.InventoryAlertsPage,
              ),
          },
          {
            path: 'movements',
            data: { title: 'Stock movements' },
            loadComponent: () =>
              import('./features/inventory/inventory-movements-list.page').then(
                (m) => m.InventoryMovementsPage,
              ),
          },
          {
            path: 'locations',
            data: { title: 'Inventory locations' },
            loadComponent: () =>
              import('./features/inventory/inventory-locations-list.page').then(
                (m) => m.InventoryLocationsPage,
              ),
          },
          {
            path: 'variants/:variantId',
            data: { title: 'Variant stock' },
            loadComponent: () =>
              import('./features/inventory/inventory-variant-detail.page').then(
                (m) => m.InventoryVariantDetailPage,
              ),
          },
        ],
      },
      {
        path: 'storefront',
        canActivate: [permissionGuard('storefront_config:view')],
        data: { title: 'Storefront', permission: 'storefront_config:view' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/storefront/pages-list.page').then(
                (m) => m.StorefrontPagesListPage,
              ),
          },
          {
            path: 'sections/:id/edit',
            canActivate: [permissionGuard('storefront_config:manage')],
            data: { title: 'Edit section', permission: 'storefront_config:manage' },
            loadComponent: () =>
              import('./features/storefront/section-editor.page').then(
                (m) => m.StorefrontSectionEditorPage,
              ),
          },
          {
            // Wildcard-friendly slug: `home`, `collections/summer`.
            path: ':pageSlug/sections/new',
            canActivate: [permissionGuard('storefront_config:manage')],
            data: { title: 'New section', permission: 'storefront_config:manage' },
            loadComponent: () =>
              import('./features/storefront/section-editor.page').then(
                (m) => m.StorefrontSectionEditorPage,
              ),
          },
          {
            path: ':pageSlug',
            loadComponent: () =>
              import('./features/storefront/sections-list.page').then(
                (m) => m.StorefrontSectionsListPage,
              ),
          },
        ],
      },
      // Catch-all BELOW the shell so deep links still trigger authGuard and
      // preserve returnTo through the login bounce. Registered feature routes
      // take precedence; this wildcard only catches genuinely unknown paths
      // for authenticated users.
      {
        path: '**',
        loadComponent: () => import('./shared/errors/not-found.page').then((m) => m.NotFoundPage),
        data: { title: 'Not found' },
      },
    ],
  },
];
