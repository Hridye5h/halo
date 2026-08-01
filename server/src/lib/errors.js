/**
 * Errors thrown anywhere in a service surface as clean HTTP responses via the
 * error middleware. Anything that is NOT an ApiError is treated as a bug and
 * reported as a generic 500 — internal details never reach the client.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(msg = 'Bad request', details) {
    return new ApiError(400, 'bad_request', msg, details);
  }
  static unauthorized(msg = 'Not authenticated') {
    return new ApiError(401, 'unauthorized', msg);
  }
  static forbidden(msg = 'Not allowed') {
    return new ApiError(403, 'forbidden', msg);
  }
  static notFound(msg = 'Not found') {
    return new ApiError(404, 'not_found', msg);
  }
  static conflict(msg = 'Already exists') {
    return new ApiError(409, 'conflict', msg);
  }
  static tooMany(msg = 'Slow down') {
    return new ApiError(429, 'rate_limited', msg);
  }
}
