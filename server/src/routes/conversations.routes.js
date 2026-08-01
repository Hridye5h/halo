import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { Friendship } from '../models/Friendship.js';
import * as messages from '../services/message.service.js';
import { emitToConversation } from '../sockets/emitter.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .sort({ 'lastMessage.sentAt': -1 })
      .lean();

    const otherIds = conversations.flatMap((c) =>
      c.participants.filter((id) => String(id) !== String(req.user._id)));
    const users = await User.find({ _id: { $in: otherIds } });
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const withCounts = await Promise.all(conversations.map(async (c) => {
      const cursor = c.readCursors?.[String(req.user._id)];
      const query = { conversationId: c._id, senderId: { $ne: req.user._id }, deletedAt: null };
      if (cursor?.messageId) query._id = { $gt: cursor.messageId };

      return {
        id: c._id,
        type: c.type,
        friendshipId: c.friendshipId,
        lastMessage: c.lastMessage,
        pinnedCount: c.pinnedMessages?.length ?? 0,
        unreadCount: await Message.countDocuments(query),
        participants: c.participants
          .filter((id) => String(id) !== String(req.user._id))
          .map((id) => userById.get(String(id))?.toPublic(req.user._id))
          .filter(Boolean),
      };
    }));

    res.json({ conversations: withCounts });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const conversation = await messages.assertMember(req.params.id, req.user._id);

    const [participants, pinned, friendship] = await Promise.all([
      User.find({ _id: { $in: conversation.participants } }),
      Message.find({ _id: { $in: conversation.pinnedMessages } }),
      conversation.friendshipId ? Friendship.findById(conversation.friendshipId).lean() : null,
    ]);

    res.json({
      conversation: {
        id: conversation._id,
        type: conversation.type,
        friendshipId: conversation.friendshipId,
        encryption: conversation.encryption,
        participants: participants.map((u) => u.toPublic(req.user._id)),
        pinnedMessages: pinned.map((m) => m.toClient()),
        stats: friendship?.stats ?? null,
        establishedAt: friendship?.establishedAt ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:id/messages',
  validate(z.object({
    before: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  }), 'query'),
  async (req, res, next) => {
    try {
      res.json(await messages.listMessages(req.user._id, req.params.id, req.validatedQuery));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * REST send. The socket path is the normal one, but this exists so a message
 * sent over HTTP is indistinguishable at rest — same service, same events.
 */
router.post(
  '/:id/messages',
  validate(z.object({
    kind: z.enum(['text', 'image', 'video', 'voice', 'file', 'chess_game', 'chess_puzzle'])
      .default('text'),
    body: z.string().max(8000).default(''),
    attachments: z.array(z.record(z.string(), z.unknown())).default([]),
    replyTo: z.string().optional(),
    clientNonce: z.string().max(64).optional(),
    encrypted: z.boolean().default(false),
  })),
  async (req, res, next) => {
    try {
      const { message } = await messages.sendMessage(req.user._id, {
        ...req.body,
        conversationId: req.params.id,
      });
      const wire = message.toClient();
      emitToConversation(req.params.id, 'message:new', { message: wire });
      res.status(201).json({ message: wire });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:id/search',
  validate(z.object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }), 'query'),
  async (req, res, next) => {
    try {
      const { q, limit } = req.validatedQuery;
      res.json({
        results: await messages.searchMessages(req.user._id, req.params.id, q, { limit }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/:id/pins/:messageId', async (req, res, next) => {
  try {
    const conversation = await messages.togglePin(
      req.user._id, req.params.id, req.params.messageId,
    );
    const pinned = await Message.find({ _id: { $in: conversation.pinnedMessages } });
    const payload = { pinnedMessages: pinned.map((m) => m.toClient()) };

    emitToConversation(req.params.id, 'conversation:pins', payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * Turns on vault mode.
 *
 * One-way on purpose: everything already written stays encrypted, so allowing
 * "off" would produce a conversation that is half readable and half not, with
 * no honest way to describe it in the UI.
 *
 * Requires every participant to have published a public key — without one
 * there is nobody to encrypt to.
 */
router.post('/:id/vault', async (req, res, next) => {
  try {
    const conversation = await messages.assertMember(req.params.id, req.user._id);

    if (conversation.encryption.mode === 'vault') {
      return res.json({ encryption: conversation.encryption });
    }

    const participants = await User.find({ _id: { $in: conversation.participants } })
      .select('publicKey username displayName')
      .lean();

    const missing = participants.filter((p) => !p.publicKey);
    if (missing.length) {
      throw ApiError.badRequest(
        `${missing.map((p) => p.displayName).join(' and ')} needs to set up their encryption key first`,
      );
    }

    conversation.encryption.mode = 'vault';
    conversation.encryption.enabledAt = new Date();
    participants.forEach((p) => {
      conversation.encryption.publicKeys.set(String(p._id), p.publicKey);
    });
    await conversation.save();

    // A system message marks the boundary, so it is obvious in the history
    // which messages are protected and which predate it.
    const marker = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      kind: 'system',
      body: `${req.user.displayName} turned on end-to-end encryption. Messages from here can only be read on your devices.`,
    });

    emitToConversation(conversation._id, 'conversation:encrypted', {
      conversationId: String(conversation._id),
      encryption: conversation.encryption,
    });
    emitToConversation(conversation._id, 'message:new', { message: marker.toClient() });

    return res.json({ encryption: conversation.encryption });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    res.json(await messages.markRead(req.user._id, req.params.id, req.body?.upToMessageId));
  } catch (err) {
    next(err);
  }
});

/**
 * The Shared Gallery. Media is queried out of the message stream by kind
 * rather than kept in a second collection — one source of truth, and a
 * deleted message disappears from the gallery for free.
 */
router.get(
  '/:id/gallery',
  validate(z.object({
    kind: z.enum(['all', 'image', 'video', 'voice', 'file']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(60),
    before: z.string().optional(),
  }), 'query'),
  async (req, res, next) => {
    try {
      await messages.assertMember(req.params.id, req.user._id);
      const { kind, limit, before } = req.validatedQuery;

      const query = {
        conversationId: req.params.id,
        deletedAt: null,
        kind: kind === 'all' ? { $in: ['image', 'video', 'voice', 'file'] } : kind,
      };
      if (before) query._id = { $lt: before };

      const items = await Message.find(query).sort({ _id: -1 }).limit(limit);
      res.json({ items: items.map((m) => m.toClient()) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
