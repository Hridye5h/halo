import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import * as auth from '../services/auth.service.js';
import * as tokens from '../services/token.service.js';
import { User } from '../models/User.js';
import { Friendship } from '../models/Friendship.js';
import { Notification } from '../models/Notification.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } },
});

const registerSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(24)
    .regex(/^[a-z0-9_]+$/, 'Usernames can use letters, numbers and underscores'),
  email: z.string().trim().toLowerCase().email('That email does not look right'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  displayName: z.string().trim().min(1).max(32).optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email'),
  password: z.string().min(1, 'Enter your password'),
});

const sessionMeta = (req) => ({
  userAgent: req.headers['user-agent'] ?? '',
  ip: req.ip ?? '',
});

async function establishSession(req, res, user) {
  const { raw } = await tokens.issueRefreshToken(user._id, sessionMeta(req));
  res.cookie(tokens.REFRESH_COOKIE, raw, tokens.refreshCookieOptions());
  return tokens.signAccessToken(user);
}

router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { user, identityToken } = await auth.registerUser(req.body);
    const accessToken = await establishSession(req, res, user);

    res.status(201).json({
      user: user.toPublic(user._id),
      accessToken,
      // Shown exactly once. It is stored hashed and cannot be recovered.
      identityToken,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const user = await auth.authenticate(req.body);
    const accessToken = await establishSession(req, res, user);
    res.json({ user: user.toPublic(user._id), accessToken });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[tokens.REFRESH_COOKIE];
    if (!raw) throw ApiError.unauthorized('No session');

    const rotated = await tokens.rotateRefreshToken(raw, sessionMeta(req));
    const user = await User.findById(rotated.userId);
    if (!user || user.supersededBy) throw ApiError.unauthorized('No session');

    res.cookie(tokens.REFRESH_COOKIE, rotated.raw, tokens.refreshCookieOptions());
    res.json({ user: user.toPublic(user._id), accessToken: tokens.signAccessToken(user) });
  } catch (err) {
    // A dead refresh token should not leave a stale cookie behind to retry with.
    res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions());
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await tokens.revokeRefreshToken(req.cookies?.[tokens.REFRESH_COOKIE]);
    res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic(req.user._id) });
});

/** Ticket for the Socket.IO handshake, so the access token stays out of URLs. */
router.post('/socket-ticket', requireAuth, (req, res) => {
  res.json({ ticket: tokens.signSocketTicket(req.user._id) });
});

/* ---------------------------------------------------------------------------
 * Identity-token recovery (ARCHITECTURE.md §6)
 *
 * Split deliberately into claim → approve. Redeeming a token only REQUESTS
 * the restore; the friend on the other side is the one who authorises it.
 * ------------------------------------------------------------------------- */

const restoreLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/identity/claim',
  restoreLimiter,
  requireAuth,
  validate(z.object({ identityToken: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const previous = await auth.resolveIdentityToken(req.body.identityToken);

      if (String(previous._id) === String(req.user._id)) {
        throw ApiError.badRequest('That token already belongs to this account');
      }

      const friendships = await Friendship.find({
        pair: previous._id,
        status: 'accepted',
      }).lean();

      if (!friendships.length) throw ApiError.notFound('That account has no friendships to restore');

      // Ask every friend for permission. Nothing moves until they say yes.
      await Notification.insertMany(friendships.map((f) => ({
        userId: f.pair.find((id) => String(id) !== String(previous._id)),
        type: 'identity_restore_request',
        actorId: req.user._id,
        title: 'Restore a friendship?',
        body: `${req.user.displayName} says they are ${previous.displayName}, returning with a new account.`,
        meta: {
          friendshipId: f._id,
          previousUserId: previous._id,
          claimantUserId: req.user._id,
          messageCount: f.stats?.messageCount ?? 0,
          mediaShared: f.stats?.mediaShared ?? 0,
        },
      })));

      res.json({
        status: 'awaiting_approval',
        previous: previous.toPublic(),
        pendingApprovals: friendships.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
