import { ApiError } from '../lib/errors.js';

/**
 * Validates and REPLACES the request part with the parsed result, so handlers
 * read coerced, trimmed, defaulted values rather than raw input.
 */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part]);

  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return next(ApiError.badRequest(details[0]?.message ?? 'Invalid request', details));
  }

  // req.query is a getter in Express 5 and cannot be assigned.
  if (part === 'query') {
    req.validatedQuery = result.data;
  } else {
    req[part] = result.data;
  }
  return next();
};
