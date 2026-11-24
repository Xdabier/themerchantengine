/**
 * The edge forwards one request id to the upstream: the client's X-Request-Id
 * when it is well formed, the id nginx minted otherwise. The access log must
 * record that same id, or a request with no header (most of them) logs an
 * empty req_id that matches nothing in the API logs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const BASE = fs.readFileSync(path.join(REPO, 'deploy', 'shared', 'nginx-base.conf'), 'utf8');

function loggedRequestId(conf: string): string | undefined {
  const format = conf.slice(conf.indexOf('log_format json_combined'));
  return /"req_id":"(\$[a-z_]+)"/.exec(format)?.[1];
}

it('logs the request id the vhosts forward', () => {
  expect(BASE).toContain('map $http_x_request_id $request_id_out {');
  expect(loggedRequestId(BASE)).toBe('$request_id_out');
});

it('the rule can fail: logging the raw client header is refused', () => {
  expect(loggedRequestId('log_format json_combined \'"req_id":"$http_x_request_id"\'')).toBe(
    '$http_x_request_id',
  );
});
