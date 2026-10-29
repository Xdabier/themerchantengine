// Holds the Render port for the whole container life, so the health check never sees it closed.
// Forwards to the API when it listens, and answers /health and a 503 while it boots or reseeds.
const http = require('http');

const target = Number(process.env.API_INTERNAL_PORT);
const agent = new http.Agent({ keepAlive: true });

http
  .createServer((req, res) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: target,
        path: req.url,
        method: req.method,
        headers: req.headers,
        agent,
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.rawHeaders);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      const ok = req.url === '/health';
      res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain', 'retry-after': '120' });
      res.end(ok ? 'ok' : 'Demo data is resetting, back in a few minutes.');
    });
    req.pipe(upstream);
  })
  .listen(process.env.PORT);
