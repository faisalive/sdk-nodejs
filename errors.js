export class RemoteBrowserError extends Error {
  /** @param {string} [message] */
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class APIError extends RemoteBrowserError {
  /**
   * @param {number | undefined} status
   * @param {unknown} error Parsed response body, if any.
   * @param {string | undefined} message
   * @param {Headers | undefined} headers
   */
  constructor(status, error, message, headers) {
    super(APIError.#makeMessage(status, error, message));
    this.status = status;
    this.error = error;
    this.headers = headers;
  }

  static #makeMessage(status, error, message) {
    const detail =
      typeof error === 'string' ? error : (error?.error ?? error?.message ?? (error ? JSON.stringify(error) : ''));
    if (status && detail) return `${status} ${detail}`;
    if (status) return `${status} status code (no body)`;
    return message || detail || '(no status code or body)';
  }

  static generate(status, error, headers) {
    const ErrorClass = STATUS_ERRORS[status] ?? (status >= 500 ? InternalServerError : APIError);
    return new ErrorClass(status, error, undefined, headers);
  }
}

export class APIConnectionError extends APIError {
  /** @param {{ message?: string, cause?: unknown }} [options] */
  constructor({ message, cause } = {}) {
    super(undefined, undefined, message || 'Connection error.', undefined);
    if (cause) this.cause = cause;
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  /** @param {{ message?: string }} [options] */
  constructor({ message } = {}) {
    super({ message: message ?? 'Request timed out.' });
  }
}

export class APIUserAbortError extends APIError {
  /** @param {{ message?: string }} [options] */
  constructor({ message } = {}) {
    super(undefined, undefined, message || 'Request was aborted.', undefined);
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
// The API answers 409 when a browser is in the wrong state for the action.
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

const STATUS_ERRORS = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: UnprocessableEntityError,
  429: RateLimitError
};
