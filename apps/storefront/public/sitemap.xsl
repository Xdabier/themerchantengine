<?xml version="1.0" encoding="UTF-8"?>
<!--
  XSLT stylesheet for the storefront's sitemap surfaces. Referenced by the
  `<?xml-stylesheet?>` processing instruction emitted from
  apps/api/src/modules/seo/seo.service.ts (SITEMAP_STYLESHEET_PI). Crawlers
  (Googlebot, Bingbot, IndexNow) ignore the PI and continue to read the raw
  XML; humans opening the sitemap in a browser get a readable HTML table
  instead of the collapsed-text fallback that browsers fall into when XML
  mixes the XHTML namespace into a non-HTML root.

  Two templates: `<sm:sitemapindex>` (index pointing at sub-sitemaps) and
  `<sm:urlset>` (sub-sitemap of URLs). Both produce semantic HTML tables.
  No JS, no external CDN, inline styles only (CSP `style-src 'self'
  'unsafe-inline'` permits them).

  This file deliberately carries NO brand token, hex, or self-hosted face.
  It is a standalone stylesheet and cannot import src/styles/brand.css, whose
  production bundle is hash-named, so any palette here would be a permanent
  second copy outside the token layer, which brand floor §2.6 forbids. It
  styles with CSS system colours and the system font stack instead, which
  also makes it respect the reader's own light or dark preference. The page
  is an operator and crawler utility, not a brand surface.
-->
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
                xmlns:xhtml="http://www.w3.org/1999/xhtml">

  <xsl:output
    method="html"
    encoding="UTF-8"
    indent="yes"
    doctype-system="about:legacy-compat"/>

  <!-- Shared head block. -->
  <xsl:template name="head">
    <xsl:param name="title"/>
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <meta name="robots" content="noindex, follow"/>
      <title><xsl:value-of select="$title"/></title>
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: Canvas;
          color: CanvasText;
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          font-size: 16px;
          line-height: 1.55;
        }
        .container {
          max-width: 1100px;
          margin: 0 auto;
          padding: 32px 24px 64px;
        }
        header.site {
          padding-block: 24px 16px;
          border-block-end: 3px solid ButtonBorder;
          margin-block-end: 32px;
        }
        h1 {
          font-size: 32px;
          font-weight: 600;
          margin: 0 0 4px;
          letter-spacing: -0.01em;
        }
        p.lede {
          color: GrayText;
          margin: 0;
          font-size: 14px;
        }
        p.lede strong { color: CanvasText; font-weight: 600; }
        p.lede a { color: LinkText; text-decoration: underline; text-underline-offset: 2px; }
        .badge {
          display: inline-block;
          padding: 4px 10px;
          background: ButtonFace;
          color: CanvasText;
          border: 1px solid ButtonBorder;
          font-size: 13px;
          font-weight: 600;
          border-radius: 9999px;
          margin-inline-end: 8px;
        }
        .stats {
          display: flex;
          gap: 24px;
          margin-block: 16px 24px;
          flex-wrap: wrap;
        }
        .stat {
          background: ButtonFace;
          border: 1px solid ButtonBorder;
          border-radius: 8px;
          padding: 12px 16px;
          min-width: 120px;
        }
        .stat .label { font-size: 12px; color: GrayText; text-transform: uppercase; letter-spacing: 0.04em; }
        .stat .value { font-size: 20px; font-weight: 700; margin-top: 2px; }
        table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid ButtonBorder;
          border-radius: 8px;
          overflow: hidden;
          font-size: 14px;
        }
        thead {
          background: ButtonFace;
          color: CanvasText;
        }
        thead th {
          text-align: start;
          padding: 12px 16px;
          font-weight: 600;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        tbody tr {
          border-block-start: 1px solid ButtonBorder;
        }
        tbody td {
          padding: 10px 16px;
          vertical-align: middle;
        }
        tbody td.url { word-break: break-all; max-width: 600px; }
        tbody td.url a {
          color: LinkText;
          text-decoration: none;
        }
        tbody td.url a:hover { text-decoration: underline; }
        tbody td.url a:focus-visible {
          outline: 2px solid LinkText;
          outline-offset: 2px;
        }
        tbody td.meta { color: GrayText; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .priority-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 9999px;
          background: ButtonFace;
          border: 1px solid ButtonBorder;
          font-size: 12px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .freq {
          color: GrayText;
          font-size: 13px;
          text-transform: capitalize;
        }
        footer.site {
          margin-block-start: 32px;
          padding-block: 16px 0;
          border-block-start: 1px solid ButtonBorder;
          color: GrayText;
          font-size: 13px;
        }
        @media (max-width: 640px) {
          h1 { font-size: 24px; }
          thead th { padding: 10px 12px; font-size: 12px; }
          tbody td { padding: 8px 12px; font-size: 13px; }
          tbody td.url { max-width: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
      </style>
    </head>
  </xsl:template>

  <!-- Shared footer block. -->
  <xsl:template name="site-footer">
    <footer class="site">
      <p>
        Generated by the storefront SEO module. Crawlers consume the raw XML; this stylesheet is for human readers only.
      </p>
    </footer>
  </xsl:template>

  <!--
    Sitemap index: lists the sub-sitemaps. Two columns (sitemap URL +
    lastmod). Each <loc> opens the sub-sitemap which itself renders via this
    stylesheet.
  -->
  <xsl:template match="/sm:sitemapindex">
    <html lang="en" dir="ltr">
      <xsl:call-template name="head">
        <xsl:with-param name="title">XML Sitemap Index</xsl:with-param>
      </xsl:call-template>
      <body>
        <div class="container">
          <header class="site">
            <h1>
              <span class="badge">Sitemap Index</span>
              XML Sitemap Index
            </h1>
            <p class="lede">
              This index points search engines at the per-section sitemaps below. Reference: <a href="https://www.sitemaps.org/protocol.html#index">sitemaps.org/protocol</a>.
            </p>
          </header>

          <section class="stats" aria-label="Sitemap index statistics">
            <div class="stat">
              <div class="label">Sub-sitemaps</div>
              <div class="value"><xsl:value-of select="count(sm:sitemap)"/></div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th scope="col">Sitemap</th>
                <th scope="col">Last modified (UTC)</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sm:sitemap">
                <tr>
                  <td class="url">
                    <a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a>
                  </td>
                  <td class="meta"><xsl:value-of select="sm:lastmod"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>

          <xsl:call-template name="site-footer"/>
        </div>
      </body>
    </html>
  </xsl:template>

  <!--
    URL set: lists every URL in a sub-sitemap with its lastmod, changefreq,
    priority, and a count of hreflang alternates. The xhtml:link siblings
    are summarized as a count rather than expanded inline to keep the table
    readable for sub-sitemaps with hundreds of entries.
  -->
  <xsl:template match="/sm:urlset">
    <html lang="en" dir="ltr">
      <xsl:call-template name="head">
        <xsl:with-param name="title">XML Sitemap</xsl:with-param>
      </xsl:call-template>
      <body>
        <div class="container">
          <header class="site">
            <h1>
              <span class="badge">Sitemap</span>
              XML Sitemap
            </h1>
            <p class="lede">
              URLs in this sub-sitemap. Crawlers read the raw XML; the table below is a human-readable view. The <strong>Hreflang</strong> column counts the localized alternates each URL declares, per Google's <a href="https://developers.google.com/search/docs/specialty/international/localized-versions#sitemap">localized-versions guidance</a>.
            </p>
          </header>

          <section class="stats" aria-label="Sitemap statistics">
            <div class="stat">
              <div class="label">URLs</div>
              <div class="value"><xsl:value-of select="count(sm:url)"/></div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th scope="col">URL</th>
                <th scope="col">Last modified (UTC)</th>
                <th scope="col">Frequency</th>
                <th scope="col">Priority</th>
                <th scope="col">Hreflang</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sm:url">
                <tr>
                  <td class="url">
                    <a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a>
                  </td>
                  <td class="meta"><xsl:value-of select="sm:lastmod"/></td>
                  <td><span class="freq"><xsl:value-of select="sm:changefreq"/></span></td>
                  <td><span class="priority-pill"><xsl:value-of select="sm:priority"/></span></td>
                  <td class="meta"><xsl:value-of select="count(xhtml:link)"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>

          <xsl:call-template name="site-footer"/>
        </div>
      </body>
    </html>
  </xsl:template>

</xsl:stylesheet>
