export interface CircuitBreakerOptions {
  /** Consecutive counted failures that open the circuit. */
  threshold: number;
  /** How long the circuit stays open before one trial call goes through. */
  cooldownMs: number;
  /** Which errors count as the remote being down. */
  isFailure: (error: unknown) => boolean;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit is open');
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  private trialInFlight = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (
      this.openedAt !== undefined &&
      (this.trialInFlight || this.now() - this.openedAt < this.options.cooldownMs)
    ) {
      throw new CircuitOpenError();
    }
    const trial = this.openedAt !== undefined;
    if (trial) this.trialInFlight = true;
    try {
      const result = await fn();
      this.failures = 0;
      this.openedAt = undefined;
      return result;
    } catch (error) {
      if (this.options.isFailure(error)) {
        this.failures += 1;
        if (trial || this.failures >= this.options.threshold) this.openedAt = this.now();
      } else if (trial) {
        this.openedAt = undefined;
        this.failures = 0;
      }
      throw error;
    } finally {
      if (trial) this.trialInFlight = false;
    }
  }
}
