/* eslint-disable */
/**
 * Jest global teardown for the backend e2e suite — stops the API instance
 * that `e2e-global-setup.ts` started (a reused, externally-started instance is
 * left running).
 */
import type { ChildProcess } from 'child_process';

export default async function globalTeardown(): Promise<void> {
  const child = (globalThis as Record<string, unknown>).__E2E_API__ as
    | ChildProcess
    | undefined;
  if (child && child.exitCode === null) {
    child.kill();
    console.log('[e2e] API instance stopped');
  }
}
