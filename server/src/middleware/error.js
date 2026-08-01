import { ApiError } from '../lib/errors.js';
import { env } from '../config/env.js';
import { log } from '../lib/logger.js';

export function notFound(_req, _res, next) {
  next(ApiError.notFound('Endpoint not found'));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Translate the two Mongo/Mongoose failures that are really user errors.
  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: 'validation_error',
        message: Object.values(err.errors)[0]?.message ?? 'Invalid data',
      },
    });
  }
  if (err?.code === 11000) {
    return res.status(409).json({
      error: { code: 'conflict', message: 'That already exists' },
    });
  }

  // Anything else is a bug. Log it in full, tell the client nothing.
  log.error(err);
  return res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong',
      ...(env.isProd ? {} : { stack: err?.stack }),
    },
  });
}
