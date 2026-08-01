import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const actorIds = [...new Set(notifications.map((n) => n.actorId).filter(Boolean).map(String))];
    const actors = await User.find({ _id: { $in: actorIds } });
    const actorById = new Map(actors.map((u) => [String(u._id), u.toPublic(req.user._id)]));

    res.json({
      notifications: notifications.map((n) => ({
        ...n,
        id: n._id,
        actor: n.actorId ? actorById.get(String(n.actorId)) ?? null : null,
      })),
      unreadCount: notifications.filter((n) => !n.readAt).length,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/read', async (req, res, next) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.user._id },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
