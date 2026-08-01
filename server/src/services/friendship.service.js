import { User } from '../models/User.js';
import { Friendship, sortPair } from '../models/Friendship.js';
import { Conversation } from '../models/Conversation.js';
import { ApiError } from '../lib/errors.js';
import { normalizeFriendCode } from '../lib/friendCode.js';
import * as timeline from './timeline.service.js';

/**
 * Looks up a user by friend code.
 *
 * Note the deliberately vague error: a distinct "no such code" response would
 * let someone sweep the code space and build a user directory, which is
 * exactly the discovery mechanic this product exists not to have. Paired with
 * a rate limit on the route (ARCHITECTURE.md §6).
 */
export async function findByFriendCode(rawCode) {
  const code = normalizeFriendCode(rawCode);
  if (!code) throw ApiError.notFound('No one found with that friend code');

  const user = await User.findOne({ friendCode: code, supersededBy: null });
  if (!user) throw ApiError.notFound('No one found with that friend code');

  return user;
}

export async function sendRequest(fromUserId, rawCode) {
  const target = await findByFriendCode(rawCode);

  if (String(target._id) === String(fromUserId)) {
    throw ApiError.badRequest("That's your own friend code");
  }

  const pair = sortPair(fromUserId, target._id);
  const existing = await Friendship.findOne({ pair });

  if (existing) {
    if (existing.status === 'accepted') throw ApiError.conflict('You are already friends');
    if (existing.status === 'blocked') throw ApiError.forbidden('Unable to send that request');

    // They already requested us — treat a second request as an acceptance.
    // Anything else would leave two people staring at each other's pending UI.
    if (String(existing.requestedBy) !== String(fromUserId)) {
      return acceptRequest(fromUserId, existing._id);
    }
    throw ApiError.conflict('Request already sent');
  }

  const friendship = await Friendship.create({
    pair,
    status: 'pending',
    requestedBy: fromUserId,
  });

  return { friendship, target, accepted: false };
}

export async function acceptRequest(userId, friendshipId) {
  const friendship = await Friendship.findById(friendshipId);
  if (!friendship) throw ApiError.notFound('Request not found');
  if (!friendship.pair.some((id) => String(id) === String(userId))) {
    throw ApiError.forbidden('Not your request');
  }
  if (friendship.status === 'accepted') throw ApiError.conflict('Already friends');
  if (String(friendship.requestedBy) === String(userId)) {
    throw ApiError.badRequest('You cannot accept your own request');
  }

  friendship.status = 'accepted';
  friendship.respondedAt = new Date();
  friendship.establishedAt = new Date();
  await friendship.save();

  const conversation = await ensureConversation(friendship);

  await timeline.record({
    friendshipId: friendship._id,
    type: 'friendship_started',
    actorId: userId,
    title: 'Friendship started',
    description: 'The beginning of everything here.',
    icon: '🤝',
    once: true,
  });

  const target = await User.findById(friendship.otherMember(userId));
  return { friendship, conversation, target, accepted: true };
}

export async function declineRequest(userId, friendshipId) {
  const friendship = await Friendship.findById(friendshipId);
  if (!friendship) throw ApiError.notFound('Request not found');
  if (!friendship.pair.some((id) => String(id) === String(userId))) {
    throw ApiError.forbidden('Not your request');
  }
  if (friendship.status !== 'pending') throw ApiError.badRequest('Nothing to decline');

  // A declined request is deleted rather than kept as a tombstone, so the
  // sender can try again later. Nothing of value is lost.
  await friendship.deleteOne();
  return friendship;
}

export async function removeFriend(userId, friendshipId) {
  const friendship = await Friendship.findById(friendshipId);
  if (!friendship) throw ApiError.notFound('Friendship not found');
  if (!friendship.pair.some((id) => String(id) === String(userId))) {
    throw ApiError.forbidden('Not your friendship');
  }

  // The conversation and its messages survive — removing a friend should not
  // silently destroy a shared history that both people own.
  await friendship.deleteOne();
  return friendship;
}

export async function setBlocked(userId, friendshipId, blocked) {
  const friendship = await Friendship.findById(friendshipId);
  if (!friendship) throw ApiError.notFound('Friendship not found');
  if (!friendship.pair.some((id) => String(id) === String(userId))) {
    throw ApiError.forbidden('Not your friendship');
  }
  if (blocked && friendship.status === 'blocked') return friendship;

  if (blocked) {
    friendship.status = 'blocked';
    friendship.blockedBy = userId;
  } else {
    if (String(friendship.blockedBy) !== String(userId)) {
      throw ApiError.forbidden('Only the person who blocked can unblock');
    }
    friendship.status = 'accepted';
    friendship.blockedBy = null;
  }

  await friendship.save();
  return friendship;
}

/** DM conversations are created lazily and exactly once per friendship. */
export async function ensureConversation(friendship) {
  const existing = await Conversation.findOne({ friendshipId: friendship._id });
  if (existing) return existing;

  return Conversation.create({
    type: 'dm',
    participants: friendship.pair,
    friendshipId: friendship._id,
  });
}

export async function listFriends(userId) {
  const friendships = await Friendship.find({
    pair: userId,
    status: { $in: ['accepted', 'blocked'] },
  }).lean();

  const otherIds = friendships.map((f) =>
    f.pair.find((id) => String(id) !== String(userId)));

  const [users, conversations] = await Promise.all([
    User.find({ _id: { $in: otherIds } }),
    Conversation.find({ friendshipId: { $in: friendships.map((f) => f._id) } }).lean(),
  ]);

  const userById = new Map(users.map((u) => [String(u._id), u]));
  const convByFriendship = new Map(
    conversations.map((c) => [String(c.friendshipId), c]),
  );

  return friendships
    .map((f) => {
      const otherId = String(f.pair.find((id) => String(id) !== String(userId)));
      const user = userById.get(otherId);
      if (!user) return null;

      return {
        friendshipId: f._id,
        status: f.status,
        blockedByMe: String(f.blockedBy) === String(userId),
        establishedAt: f.establishedAt,
        stats: f.stats,
        conversationId: convByFriendship.get(String(f._id))?._id ?? null,
        user: user.toPublic(userId),
      };
    })
    .filter(Boolean);
}

export async function listPendingRequests(userId) {
  const friendships = await Friendship.find({ pair: userId, status: 'pending' }).lean();

  const incoming = friendships.filter((f) => String(f.requestedBy) !== String(userId));
  const outgoing = friendships.filter((f) => String(f.requestedBy) === String(userId));

  const involved = friendships.map((f) =>
    f.pair.find((id) => String(id) !== String(userId)));
  const users = await User.find({ _id: { $in: involved } });
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const shape = (f) => {
    const otherId = String(f.pair.find((id) => String(id) !== String(userId)));
    return {
      friendshipId: f._id,
      requestedAt: f.createdAt,
      user: userById.get(otherId)?.toPublic(userId) ?? null,
    };
  };

  return {
    incoming: incoming.map(shape).filter((r) => r.user),
    outgoing: outgoing.map(shape).filter((r) => r.user),
  };
}

/**
 * Re-points a friendship graph at a rebuilt account.
 *
 * The consent step lives in the controller, not here: this function performs
 * a restore that has ALREADY been approved by the friend on the other side.
 * Keeping the approval out of this function makes it impossible to call the
 * "just do it" path by accident from somewhere that skipped the prompt.
 */
export async function transferFriendship(friendshipId, fromUserId, toUserId) {
  const friendship = await Friendship.findById(friendshipId);
  if (!friendship) throw ApiError.notFound('Friendship not found');

  friendship.pair = sortPair(
    friendship.otherMember(fromUserId),
    toUserId,
  );
  await friendship.save();

  await Conversation.updateOne(
    { friendshipId: friendship._id },
    { $set: { participants: friendship.pair } },
  );

  await timeline.record({
    friendshipId: friendship._id,
    type: 'identity_restored',
    actorId: toUserId,
    title: 'Connection restored',
    description: 'A new account was linked to this friendship. Nothing was lost.',
    icon: '🔗',
  });

  return friendship;
}
