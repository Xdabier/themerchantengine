import type { Ports, ResendDomainStatus, S3ProbeConfig } from '../ports';

/**
 * A recording double for the specs. Every verification succeeds unless the
 * spec sets a failure, and every call is recorded so a step's spec can assert
 * what was verified and with which credential.
 */
export interface FakePorts extends Ports {
  files: Map<string, string>;
  hosts: Map<string, string[]>;
  addresses: string[];
  calls: { name: string; args: unknown[] }[];
  failures: Partial<Record<keyof Ports, string>>;
  resendStatus: ResendDomainStatus;
  turnstileAccepted: boolean;
  gscSitemaps: string[];
  bingSites: string[];
  clock: Date;
}

export function fakePorts(overrides: Partial<FakePorts> = {}): FakePorts {
  const ports: FakePorts = {
    files: new Map(),
    hosts: new Map(),
    addresses: ['203.0.113.5'],
    calls: [],
    failures: {},
    resendStatus: { found: true, status: 'verified' },
    turnstileAccepted: true,
    gscSitemaps: ['https://shop.example/sitemap.xml'],
    bingSites: ['https://shop.example/'],
    clock: new Date('2026-09-06T00:00:00Z'),
    now: () => ports.clock,
    fileExists: (file) => ports.files.has(file),
    readFile: (file) => {
      const content = ports.files.get(file);
      if (content === undefined) throw new Error(`ENOENT: ${file}`);
      return content;
    },
    async resolveHost(hostname) {
      return ports.hosts.get(hostname) ?? [];
    },
    async publicAddresses() {
      return ports.addresses;
    },
    async s3Probe(config: S3ProbeConfig) {
      record('s3Probe', config);
    },
    async s3Put(config: S3ProbeConfig, key: string, body: Buffer, contentType: string) {
      record('s3Put', config, key, body.length, contentType);
    },
    async resendDomain(apiKey, domain) {
      record('resendDomain', apiKey, domain);
      return ports.resendStatus;
    },
    async resendSend(apiKey, from, to, subject, text) {
      record('resendSend', apiKey, from, to, subject, text);
      return 'msg_1';
    },
    async turnstileSecretAccepted(secretKey) {
      record('turnstileSecretAccepted', secretKey);
      return ports.turnstileAccepted;
    },
    async gscListSitemaps(json, siteUrl) {
      record('gscListSitemaps', json, siteUrl);
      return ports.gscSitemaps;
    },
    async bingListSites(apiKey) {
      record('bingListSites', apiKey);
      return ports.bingSites;
    },
    ...overrides,
  };
  function record(name: keyof Ports, ...args: unknown[]): void {
    ports.calls.push({ name, args });
    const failure = ports.failures[name];
    if (failure) throw new Error(failure);
  }
  return ports;
}
