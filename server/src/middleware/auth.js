import { User } from '../models/User.js';
import { ApiError } from '../lib/errors.js';
import { verifyAccessToken } from '../services/token.service.js';

/** Populates `req.user`. Rejects if the bearer token is missing or invalid. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized();

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.supersededBy) throw ApiError.unauthorized();

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
