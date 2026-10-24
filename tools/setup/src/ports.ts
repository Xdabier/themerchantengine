/**
 * The edges of the stepper: everything that reaches outside the process.
 * Steps depend on this interface only, so their specs run against fakes and
 * the real implementations (`ports/real.ts`) are exercised by their own
 * narrow specs. Every verification throws with a message the operator can
 * act on, or returns quietly.
 */
export interface S3ProbeConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Path-style addressing, needed when the bucket name carries a dot. */
  forcePathStyle: boolean;
}

export interface ResendDomainStatus {
  /** The domain as Resend knows it, or null when the account has no such domain. */
  found: boolean;
  /** `verified`, `pending`, `failed`, `not_started` per Resend. */
  status: string | null;
}

export interface Ports {
  now(): Date;
  fileExists(file: string): boolean;
  readFile(file: string): string;
  /** IPv4 and IPv6 addresses a hostname resolves to; empty when it does not resolve. */
  resolveHost(hostname: string): Promise<string[]>;
  /** The public addresses of this box, as seen from the outside. */
  publicAddresses(): Promise<string[]>;

  /** Put, get and delete one probe object; throws with the failing operation named. */
  s3Probe(config: S3ProbeConfig): Promise<void>;
  /** Puts one public object; the runner uploads the logo through it. */
  s3Put(config: S3ProbeConfig, key: string, body: Buffer, contentType: string): Promise<void>;
  /** Looks the sending domain up in the Resend account. Throws on a refused key. */
  resendDomain(apiKey: string, domain: string): Promise<ResendDomainStatus>;
  /** Sends one message; resolves to the message id. */
  resendSend(
    apiKey: string,
    from: string,
    to: string,
    subject: string,
    text: string,
  ): Promise<string>;
  /** True when the secret is accepted by Cloudflare's siteverify, whatever it says about the token. */
  turnstileSecretAccepted(secretKey: string): Promise<boolean>;
  /** Lists the sitemaps Search Console holds for the property; throws when the account cannot. */
  gscListSitemaps(serviceAccountJson: string, siteUrl: string): Promise<string[]>;
  /** Lists the sites the Bing Webmaster key can see; throws on a refused key. */
  bingListSites(apiKey: string): Promise<string[]>;
}
