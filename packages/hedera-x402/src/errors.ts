/**
 * Upstream failure classification.
 *
 * The middleware must not retry a deterministic failure, and must not sell a
 * quote for a question the upstream cannot answer. Previously every upstream
 * error was retried three times with no backoff and the caller was then
 * charged for the failure — so a request for a pool that does not exist cost
 * the caller P and produced a 502.
 */

/** Base class so callers can `instanceof` one type. */
export abstract class UpstreamError extends Error {
  /** Whether retrying the identical request could plausibly succeed. */
  abstract readonly retryable: boolean;
  /** HTTP status the middleware should surface to the caller. */
  abstract readonly status: number;
}

/** The upstream answered, and the answer is "no such thing". Never retry. */
export class UpstreamNotFound extends UpstreamError {
  readonly retryable = false;
  readonly status = 404;
  constructor(what: string) {
    super(`upstream has no such resource: ${what}`);
    this.name = "UpstreamNotFound";
  }
}

/** The request was malformed as far as the upstream is concerned. Never retry. */
export class UpstreamBadRequest extends UpstreamError {
  readonly retryable = false;
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "UpstreamBadRequest";
  }
}

/** Transient: timeout, 5xx, connection reset. Retry with backoff. */
export class UpstreamUnavailable extends UpstreamError {
  readonly retryable = true;
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = "UpstreamUnavailable";
  }
}

/**
 * Classify an arbitrary thrown value. Anything not explicitly typed is treated
 * as transient, because an unknown failure is more likely a network blip than
 * a deterministic "no" — but a typed error always wins.
 */
export function isRetryable(e: unknown): boolean {
  if (e instanceof UpstreamError) return e.retryable;
  return true;
}

/** HTTP status for a thrown value; unknown failures surface as 502. */
export function upstreamStatus(e: unknown): number {
  return e instanceof UpstreamError ? e.status : 502;
}

/** Map an upstream HTTP status onto the right error type. */
export function fromHttpStatus(status: number, what: string): UpstreamError {
  if (status === 404) return new UpstreamNotFound(what);
  if (status >= 400 && status < 500) {
    return new UpstreamBadRequest(`${what} (upstream ${status})`);
  }
  return new UpstreamUnavailable(`${what} (upstream ${status})`);
}
