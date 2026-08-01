import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import { User, PRESENCE_STATUSES } from '../models/User.js';
import { Friendship } from '../models/Friendship.js';
import * as presence from '../services/presence.service.js';
import { emitToUser } from '../sockets/emitter.js';

const router = Router();
router.use(requireAuth);

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  bio: z.string().trim().max(500).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().or(z.literal('')).optional(),
  pronouns: z.string().trim().max(24).optional(),
  timezone: z.string().trim().max(64).optional(),
  avatarUrl: z.string().trim().max(500).optional(),
  bannerUrl: z.string().trim().max(500).optional(),
  chess: z.object({
    chesscomUsername: z.string().trim().max(50).optional(),
    lichessUsername: z.string().trim().max(50).optional(),
  }).optional(),
});

const themeSchema = z.object({
  name: z.string().min(1).max(40),
  colors: z.record(z.string(), z.string().max(60)),
});

const settingsSchema = z.object({
  theme: z.string().max(40).optional(),
  customTheme: themeSchema.nullable().optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  reducedMotion: z.boolean().optional(),
  hideLastSeen: z.boolean().optional(),
  invisible: z.boolean().optional(),
  notifications: z.object({
    messages: z.boolean().optional(),
    presence: z.boolean().optional(),
    sounds: z.boolean().optional(),
  }).optional(),
});

router.patch('/me', validate(profileSchema), async (req, res, next) => {
  try {
    const { chess, ...fields } = req.body;
    Object.assign(req.user, fields);
    if (chess) Object.assign(req.user.chess, chess);
    await req.user.save();

    // Friends see profile changes live — this is one of the small touches that
    // makes the app feel alive rather than like a page you refresh.
    const friendships = await Friendship.find({ pair: req.user._id, status: 'accepted' })
      .select('pair')
      .lean();

    friendships.forEach((f) => {
      const otherId = f.pair.find((id) => String(id) !== String(req.user._id));
      emitToUser(otherId, 'friend:updated', { user: req.user.toPublic(otherId) });
    });

    res.json({ user: req.user.toPublic(req.user._id) });
  } catch (err) {
    next(err);
  }
});

/**
 * Publishes the user's ECDH public key.
 *
 * Only the public half — the server never sees, stores, or transmits a private
 * key or vault passphrase. Replacing a key is allowed (new device, lost key),
 * but it makes previously encrypted messages undecryptable for this user, so
 * the client warns before doing it.
 */
router.put(
  '/me/keys',
  validate(z.object({ publicKey: z.string().min(40).max(500) })),
  async (req, res, next) => {
    try {
      req.user.publicKey = req.body.publicKey;
      req.user.publicKeyUpdatedAt = new Date();
      await req.user.save();

      // Friends need to know a key changed — a silently rotated key would let
      // an attacker who controls the server substitute their own.
      const friendships = await Friendship.find({ pair: req.user._id, status: 'accepted' })
        .select('pair')
        .lean();

      friendships.forEach((f) => {
        const otherId = f.pair.find((id) => String(id) !== String(req.user._id));
        emitToUser(otherId, 'friend:keyChanged', {
          userId: String(req.user._id),
          publicKey: req.body.publicKey,
        });
      });

      res.json({ publicKey: req.user.publicKey });
    } catch (err) {
      next(err);
    }
  },
);

router.patch('/me/settings', validate(settingsSchema), async (req, res, next) => {
  try {
    const { notifications, ...rest } = req.body;
    Object.assign(req.user.settings, rest);
    if (notifications) Object.assign(req.user.settings.notifications, notifications);
    await req.user.save();

    res.json({ settings: req.user.settings });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/me/presence',
  validate(z.object({
    status: z.enum(PRESENCE_STATUSES).optional(),
    customStatus: z.string().max(64).optional(),
  })),
  async (req, res, next) => {
    try {
      const intent = await presence.setIntent(req.user._id, req.body);
      res.json({ presence: intent });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Profiles are visible to friends only.
 *
 * There is no user search and no browse — the only way to reach someone new is
 * a friend code they chose to give you (ARCHITECTURE.md §6).
 */
router.get('/:id', async (req, res, next) => {
  try {
    const isSelf = String(req.params.id) === String(req.user._id);

    if (!isSelf) {
      const friendship = await Friendship.between(req.user._id, req.params.id);
      if (!friendship || friendship.status !== 'accepted') {
        throw ApiError.forbidden('You can only view friends’ profiles');
      }
    }

    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('User not found');

    res.json({ user: user.toPublic(req.user._id) });
  } catch (err) {
    next(err);
  }
});

export default router;
