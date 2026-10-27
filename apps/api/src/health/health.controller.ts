import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@common/decorators';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({
    status: 200,
    description: 'Application is running',
    schema: {
      example: {
        data: {
          status: 'ok',
          timestamp: '2024-04-04T11:00:00.000Z',
        },
      },
    },
  })
  /**
   * Returns the bare payload: the global `ApiResponseInterceptor` adds the
   * `data` envelope. Wrapping it here too produced `{ data: { data: ... } }`,
   * which contradicted the Swagger example above.
   */
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Identity of the running API, for the e2e harnesses.
 *
 * `/health` is registered outside the global prefix and answers 200 on any
 * instance whatever database it was started against, so it cannot separate a
 * test API from a dev one. Three harnesses adopted whatever answered on the
 * test port on that evidence alone, and for two weeks in May one of them wrote
 * Playwright fixtures into the developer's dev database.
 *
 * This route lives UNDER `v1` deliberately: it then picks up the global prefix
 * when one is set, so the admin harness can reach it through the very
 * `/api` proxy its specs use (`/api/v1/health/identity`), and the backend
 * harness reaches it bare (`/v1/health/identity`) on its unprefixed spawn. A
 * guard that cannot be reached through the same base URL as the specs proves
 * nothing about where the specs are pointed.
 *
 * Constitution §3.7 bounds the payload: the database NAME only, and only in
 * test mode. Never the URL, the host, or the credentials.
 */
@Controller('v1/health')
export class HealthIdentityController {
  @Get('identity')
  @Public()
  @ApiOperation({ summary: 'Runtime identity (env, and the database name in test mode)' })
  @ApiResponse({
    status: 200,
    description: 'Runtime identity',
    schema: { example: { data: { env: 'test', database: 'merchants_engine_test' } } },
  })
  identity(): { env: string; database?: string } {
    const env = process.env.NODE_ENV ?? 'development';
    // Outside test mode the answer is the bare env word and nothing else, so
    // a public route on a production box discloses no topology.
    if (env !== 'test') return { env };
    return { env, database: databaseName(process.env.DATABASE_URL) };
  }
}

/**
 * The database name alone, parsed off the connection string.
 *
 * Returns `unknown` rather than throwing on anything unparseable: a guard that
 * crashes the process it is meant to identify is worse than one that reports
 * an answer the caller will reject anyway.
 */
function databaseName(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const name = new URL(url).pathname.replace(/^\//, '');
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}
