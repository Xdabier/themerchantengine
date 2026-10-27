import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now: number;
  const isFailure = (error: unknown) => error instanceof TypeError;
  const fail = () => Promise.reject(new TypeError('down'));

  function breaker(): CircuitBreaker {
    return new CircuitBreaker({ threshold: 2, cooldownMs: 1000, isFailure, now: () => now });
  }

  beforeEach(() => {
    now = 0;
  });

  it('passes results and errors through while closed', async () => {
    const b = breaker();
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
    await expect(b.run(fail)).rejects.toThrow(TypeError);
  });

  it('opens after the threshold of counted failures and short-circuits', async () => {
    const b = breaker();
    await expect(b.run(fail)).rejects.toThrow(TypeError);
    await expect(b.run(fail)).rejects.toThrow(TypeError);
    const call = jest.fn(async () => 'ok');
    await expect(b.run(call)).rejects.toThrow(CircuitOpenError);
    expect(call).not.toHaveBeenCalled();
  });

  it('does not count errors the predicate rejects', async () => {
    const b = breaker();
    for (let i = 0; i < 3; i += 1) {
      await expect(b.run(() => Promise.reject(new RangeError('declined')))).rejects.toThrow(
        RangeError,
      );
    }
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('lets one trial call through after the cooldown and closes on success', async () => {
    const b = breaker();
    await expect(b.run(fail)).rejects.toThrow();
    await expect(b.run(fail)).rejects.toThrow();
    now = 1000;
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
    await expect(b.run(fail)).rejects.toThrow(TypeError);
  });

  it('reopens at once when the trial call fails', async () => {
    const b = breaker();
    await expect(b.run(fail)).rejects.toThrow();
    await expect(b.run(fail)).rejects.toThrow();
    now = 1000;
    await expect(b.run(fail)).rejects.toThrow(TypeError);
    await expect(b.run(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('short-circuits concurrent calls while the trial call is in flight', async () => {
    const b = breaker();
    await expect(b.run(fail)).rejects.toThrow();
    await expect(b.run(fail)).rejects.toThrow();
    now = 1000;
    let settle: (value: string) => void = () => undefined;
    const trial = b.run(() => new Promise<string>((resolve) => (settle = resolve)));
    const second = jest.fn(async () => 'ok');
    await expect(b.run(second)).rejects.toThrow(CircuitOpenError);
    expect(second).not.toHaveBeenCalled();
    settle('ok');
    await expect(trial).resolves.toBe('ok');
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('resets the failure count after a success', async () => {
    const b = breaker();
    await expect(b.run(fail)).rejects.toThrow();
    await b.run(async () => 'ok');
    await expect(b.run(fail)).rejects.toThrow(TypeError);
    await expect(b.run(async () => 'ok')).resolves.toBe('ok');
  });
});
