const path = require('path');

/**
 * Storefront Tailwind config.
 *
 * Authority: agent_docs/storefront/brand-tokens.md.
 *
 * Tokens are CSS custom properties in src/styles/brand.css and are consumed
 * through `var(--brand-*)` at the call site. The `theme.extend` block that
 * used to mirror them here was dead: a scan of every `class` attribute in the
 * storefront found zero brand utilities, so the aliases only created a second
 * place for the palette, the type scale, and the font families to drift from
 * the token layer. Never hardcode hex outside src/styles/brand.css.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: [path.join(__dirname, 'src/**/*.{html,ts}'), path.join(__dirname, 'index.html')],
  plugins: [],
  corePlugins: {
    // Brand mandate: no decorative gradients.
    backgroundImage: false,
  },
};
