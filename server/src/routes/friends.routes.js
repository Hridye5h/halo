import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import * as friends from '../services/friendship.service.js';
import * as timeline from '../services/timeline.service.js';
import { Friendship } from '../models/Friendship.js';
import { Notification } from '../models/Notification.js';
import { emitToUser } from '../sockets/emitter.js';

const router = Router();
router.use(requireAuth);

/**
 * Rate limit on code lookups is a security control, not politeness: without
 * it the friend-code space is enumerable and the app grows a user directory.
 */
const lookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user?._id ?? req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many lookups. Try again shortly.' } },
});

router.get('/', async (req, res, next) => {
  try {
    res.json({ friends: await friends.listFriends(req.user._id) });
  } catch (err) {
    next(err);
  }
});

router.get('/requests', async (req, res, next) => {
  try {
    res.json(await friends.listPendingRequests(req.user._id));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/lookup',
  lookupLimiter,
  validate(z.object({ friendCode: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const user = await friends.findByFriendCode(req.body.friendCode);
      res.json({ user: user.toPublic(req.user._id) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/request',
  lookupLimiter,
  validate(z.object({ friendCode: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const result = await friends.sendRequest(req.user._id, req.body.friendCode);

      await Notification.create({
        userId: result.target._id,
        type: result.accepted ? 'friend_accepted' : 'friend_request',
        actorId: req.user._id,
        title: result.accepted ? 'You are now friends' : 'New friend request',
        body: `${req.user.displayName} (@${req.user.username})`,
        meta: { friendshipId: result.friendship._id },
      });

      emitToUser(result.target._id, result.accepted ? 'friend:accepted' : 'friend:request', {
        friendshipId: result.friendship._id,
        user: req.user.toPublic(result.target._id),
      });

      res.status(201).json({
        friendship: {
          id: result.friendship._id,
          status: result.friendship.status,
        },
        user: result.target.toPublic(req.user._id),
        accepted: result.accepted,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/:id/accept', async (req, res, next) => {
  try {
    const result = await friends.acceptRequest(req.user._id, req.params.id);

    await Notification.create({
      userId: result.target._id,
      type: 'friend_accepted',
      actorId: req.user._id,
      title: 'Friend request accepted',
      body: `${req.user.displayName} accepted your request`,
      meta: { friendshipId: result.friendship._id },
    });

    emitToUser(result.target._id, 'friend:accepted', {
      friendshipId: result.friendship._id,
      conversationId: result.conversation._id,
      user: req.user.toPublic(result.target._id),
    });

    res.json({
      friendshipId: result.friendship._id,
      conversationId: result.conversation._id,
      user: result.target.toPublic(req.user._id),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/decline', async (req, res, next) => {
  try {
    await friends.declineRequest(req.user._id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await friends.removeFriend(req.user._id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/block',
  validate(z.object({ blocked: z.boolean() })),
  async (req, res, next) => {
    try {
      const friendship = await friends.setBlocked(req.user._id, req.params.id, req.body.blocked);
      res.json({ friendshipId: friendship._id, status: friendship.status });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/:id/timeline', async (req, res, next) => {
  try {
    const friendship = await Friendship.findById(req.params.id).lean();
    if (!friendship?.pair.some((id) => String(id) === String(req.user._id))) {
      throw ApiError.forbidden('Not your friendship');
    }
    res.json({ events: await timeline.listForFriendship(friendship._id) });
  } catch (err) {
    next(err);
  }
});

/**
 * Approves an identity restore. This is the consent gate — the only path that
 * can re-point a friendship at a rebuilt account.
 */
router.post('/restore/:notificationId', async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      userId: req.user._id,
      type: 'identity_restore_request',
    });
    if (!notification) throw ApiError.notFound('Request not found');

    const { friendshipId, previousUserId, claimantUserId } = notification.meta ?? {};
    await friends.transferFriendship(friendshipId, previousUserId, claimantUserId);

    notification.readAt = new Date();
    await notification.save();

    emitToUser(claimantUserId, 'friend:restored', { friendshipId });
    res.json({ ok: true, friendshipId });
  } catch (err) {
    next(err);
  }
});

export default router;
