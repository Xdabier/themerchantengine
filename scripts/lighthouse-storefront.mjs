#!/usr/bin/env node
/**
 * Storefront Lighthouse runner used by AV5 cutover verification.
 *
 * Captures Performance + LCP for the fixtureCatalogue home page and a product
 * detail page, prints a structured summary, and exits non-zero if LCP is
 * above the budget at `agent_docs/storefront/quality-gates.md`.
 *
 * Usage:
 *   node scripts/lighthouse-storefront.mjs [target]
 *
 *   target = "home" | "product" | "all" (default: "all")
 *
 * Env overrides:
 *   STOREFRONT_BASE_URL    base URL of the running storefront (default http://localhost:53300/en)
 *   PRODUCT_PATH           path under base used for the product LCP run
 *                          (default: /catalog/product/fx-laptop-pro-14-standard)
 *   LCP_BUDGET_MS          override the spec budget (default 2500 — quality-gates.md:23)
 *
 * Shells out to the local `lighthouse` CLI binary (installed as a dev dep)
 * rather than driving the programmatic API, so we don't need a separate
 * chrome-launcher dep — the CLI launches Chrome itself.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const BASE_URL = (process.env.STOREFRONT_BASE_URL ?? 'http://localhost:53300/en').replace(/\/$/, '');
const PRODUCT_PATH = process.env.PRODUCT_PATH ?? '/catalog/product/fx-laptop-pro-14-standard';
const LCP_BUDGET_MS = Number.parseInt(process.env.LCP_BUDGET_MS ?? '2500', 10);
const OUT_DIR = path.resolve(process.cwd(), '.lighthouse');

const targetArg = (process.argv[2] ?? 'all').toLowerCase();

function runLighthouse(label, url) {
  const reportPath = path.join(OUT_DIR, `${label}.json`);
  const args = [
    'lighthouse',
    url,
    '--quiet',
    '--output=json',
    `--output-path=${reportPath}`,
    '--only-categories=performance',
    `--chrome-flags=--headless=new --no-sandbox --disable-gpu --ignore-certificate-errors --allow-insecure-localhost --unsafely-treat-insecure-origin-as-secure=${BASE_URL.replace(/\/[^/]*$/, '')} --disable-features=BlockInsecurePrivateNetworkRequests,UpgradeInsecureRequests`,
    // Default mobile + simulated 3G — matches the LCP budget profile in
    // `agent_docs/storefront/quality-gates.md` ("3G Slow / mobile mid-tier").
    // Pass `--preset=desktop` via `LIGHTHOUSE_PRESET=desktop` if a desktop
    // capture is genuinely required (e.g. ad-hoc perf debug on a wide
    // viewport). The default budget would otherwise be too lenient.
    ...(process.env.LIGHTHOUSE_PRESET ? [`--preset=${process.env.LIGHTHOUSE_PRESET}`] : []),
    '--throttling-method=simulate',
    '--max-wait-for-load=60000',
  ];
  // CHROME_PATH is honored by lighthouse's chrome-launcher; otherwise it
  // probes the default install dirs on Windows / mac / Linux.
  const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`lighthouse exited with status ${result.status} for ${url}`);
  }
  return reportPath;
}

async function summarize(label, url, reportPath) {
  const lhr = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const lcp = lhr.audits['largest-contentful-paint'];
  const fcp = lhr.audits['first-contentful-paint'];
  const tbt = lhr.audits['total-blocking-time'];
  const cls = lhr.audits['cumulative-layout-shift'];
  const score = lhr.categories.performance?.score ?? null;
  return {
    label,
    url,
    reportPath,
    score,
    lcp: lcp.numericValue,
    lcpDisplay: lcp.displayValue,
    fcp: fcp.numericValue,
    fcpDisplay: fcp.displayValue,
    tbt: tbt.numericValue,
    tbtDisplay: tbt.displayValue,
    cls: cls.numericValue,
    clsDisplay: cls.displayValue,
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const targets = [];
  if (targetArg === 'home' || targetArg === 'all') {
    targets.push({ label: 'home', url: `${BASE_URL}/` });
  }
  if (targetArg === 'product' || targetArg === 'all') {
    targets.push({ label: 'product', url: `${BASE_URL}${PRODUCT_PATH}` });
  }
  if (targets.length === 0) {
    console.error(`Unknown target "${targetArg}". Use one of: home, product, all`);
    process.exit(2);
  }

  const results = [];
  for (const t of targets) {
    process.stdout.write(`\nRunning Lighthouse on ${t.label}: ${t.url}\n`);
    const reportPath = runLighthouse(t.label, t.url);
    results.push(await summarize(t.label, t.url, reportPath));
  }

  let failed = false;
  for (const r of results) {
    const overBudget = r.lcp > LCP_BUDGET_MS;
    if (overBudget) failed = true;
    console.log('');
    console.log(`=== ${r.label} ===`);
    console.log(`url:               ${r.url}`);
    console.log(`performance score: ${r.score === null ? 'n/a' : (r.score * 100).toFixed(0)}`);
    console.log(`LCP:               ${r.lcpDisplay}  (${r.lcp.toFixed(0)}ms)  ${overBudget ? `OVER BUDGET (${LCP_BUDGET_MS}ms)` : 'within budget'}`);
    console.log(`FCP:               ${r.fcpDisplay}`);
    console.log(`TBT:               ${r.tbtDisplay}`);
    console.log(`CLS:               ${r.clsDisplay}`);
    console.log(`report:            ${path.relative(process.cwd(), r.reportPath)}`);
  }
  console.log('');
  if (failed) {
    console.error(`FAIL — at least one target exceeded LCP budget ${LCP_BUDGET_MS}ms.`);
    process.exit(1);
  }
}

await main();
