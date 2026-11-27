// Holds the Render port for the whole container life, so the health check never sees it closed.
// Forwards to the API when it listens, and answers /health and a 503 while it boots or reseeds.
// Also rate limits each visitor and the whole demo, and answers /status for the demo buttons.
const fs = require('fs');
const http = require('http');

const target = Number(process.env.API_INTERNAL_PORT);
const agent = new http.Agent({ keepAlive: true });
const STATE_FILE = process.env.DEMO_STATE_FILE || '/tmp/demo-state';
const RESET_HOUR_UTC = 3;

const num = (name, fallback) => Number(process.env[name]) || fallback;
// Per visitor: a burst of 120 requests, then 2 a second. A storefront page needs about 10.
const IP_BURST = num('DEMO_IP_BURST', 120);
const IP_PER_SEC = num('DEMO_IP_PER_SEC', 2);
// Whole demo: a burst of 400 requests, then 40 a second, whatever the visitors claim to be.
const ALL_BURST = num('DEMO_ALL_BURST', 400);
const ALL_PER_SEC = num('DEMO_ALL_PER_SEC', 40);
const MAX_TRACKED_IPS = 20000;

function bucket(burst) {
  return { tokens: burst, at: Date.now() };
}

function take(b, burst, perSec) {
  const now = Date.now();
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSec);
  b.at = now;
  if (b.tokens < 1) return Math.ceil((1 - b.tokens) / perSec);
  b.tokens -= 1;
  return 0;
}

const all = bucket(ALL_BURST);
const perIp = new Map();

// Drop visitors whose bucket has refilled, so the map only holds recent ones.
setInterval(() => {
  const fullAfterMs = (IP_BURST / IP_PER_SEC) * 1000;
  const now = Date.now();
  for (const [ip, b] of perIp) if (now - b.at > fullAfterMs) perIp.delete(ip);
}, 60000).unref();

// Netlify sends the visitor address in its own header. Direct hits come through Render's proxy.
function clientIp(req) {
  const h = req.headers;
  const first = (v) => (typeof v === 'string' ? v.split(',')[0].trim() : '');
  return first(h['x-nf-client-connection-ip']) || first(h['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
}

function retryAfterIp(ip) {
  let b = perIp.get(ip);
  if (!b) {
    if (perIp.size >= MAX_TRACKED_IPS) perIp.clear();
    b = bucket(IP_BURST);
    perIp.set(ip, b);
  }
  return take(b, IP_BURST, IP_PER_SEC);
}

function tooMany(res, seconds) {
  res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(seconds) });
  res.end(JSON.stringify({
    error: { code: 'DEMO_RATE_LIMITED', message: 'Too many requests to the demo. Try again in a few seconds.' },
  }));
}

function nextResetAt() {
  const next = new Date();
  next.setUTCHours(RESET_HOUR_UTC, 0, 0, 0);
  if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// The entrypoint writes "<state> <unix seconds>" when the demo changes phase.
function readState() {
  try {
    const [state, at] = fs.readFileSync(STATE_FILE, 'utf8').trim().split(/\s+/);
    return { state, since: new Date(Number(at) * 1000).toISOString() };
  } catch {
    return { state: 'booting', since: null };
  }
}

// One catalogue read proves the API and the database both answer.
function probe(done) {
  const req = http.get({ host: '127.0.0.1', port: target, path: '/api/v1/products?pageSize=1', agent, timeout: 4000 }, (reply) => {
    reply.resume();
    done(reply.statusCode >= 200 && reply.statusCode < 300);
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => done(false));
}

let cachedStatus = null;
let cachedAt = 0;
function status(done) {
  if (cachedStatus && Date.now() - cachedAt < 15000) return done(cachedStatus);
  const { state, since } = readState();
  const finish = (s) => {
    cachedStatus = { state: s, since, nextResetAt: nextResetAt() };
    cachedAt = Date.now();
    done(cachedStatus);
  };
  if (state !== 'up') return finish(state);
  probe((ok) => finish(ok ? 'up' : 'down'));
}

function sendStatus(req, res) {
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    return res.end();
  }
  status((body) => {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ data: body }));
  });
}

function forward(req, res, ip) {
  // The API trusts loopback (TRUST_PROXY=loopback), so this one entry becomes req.ip.
  const headers = { ...req.headers, 'x-forwarded-for': ip };
  const upstream = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers, agent },
    (reply) => { res.writeHead(reply.statusCode, reply.rawHeaders); reply.pipe(res); });
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    const ok = req.url === '/health';
    res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain', 'retry-after': '120' });
    res.end(ok ? 'ok' : 'Demo data is resetting, back in a few minutes.');
  });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/status') return sendStatus(req, res);
  const ip = clientIp(req);
  if (path !== '/health') {
    const wait = retryAfterIp(ip) || take(all, ALL_BURST, ALL_PER_SEC);
    if (wait) return tooMany(res, wait);
  }
  forward(req, res, ip);
}).listen(process.env.PORT);
