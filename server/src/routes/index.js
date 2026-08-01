import { Router } from 'express';
import authRoutes from './auth.routes.js';
import usersRoutes from './users.routes.js';
import friendsRoutes from './friends.routes.js';
import conversationsRoutes from './conversations.routes.js';
import notificationsRoutes from './notifications.routes.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/friends', friendsRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/notifications', notificationsRoutes);

export default router;
