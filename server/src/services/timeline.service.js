import { TimelineEvent } from '../models/TimelineEvent.js';

/**
 * Records a timeline event.
 *
 * `once` makes an event idempotent at the database level, so callers can fire
 * optimistically without a check-then-write race. Pass `true` to allow the
 * type only once per friendship ("first message"), or a string to scope it
 * more narrowly ("the 1,000-message milestone, once").
 */
export async function record({
  friendshipId, type, actorId, title, description, icon, meta, occurredAt, once,
}) {
  try {
    return await TimelineEvent.create({
      friendshipId,
      type,
      actorId: actorId ?? null,
      title: title ?? '',
      description: description ?? '',
      icon: icon ?? '✨',
      meta: meta ?? {},
      occurredAt: occurredAt ?? new Date(),
      uniqueKey: once === true ? type : (once || null),
    });
  } catch (err) {
    if (err?.code === 11000) return null; // already recorded — expected
    throw err;
  }
}

const MESSAGE_MILESTONES = [1, 100, 500, 1000, 5000, 10_000, 50_000, 100_000];

/** Emits a milestone event when a message count crosses a round number. */
export async function checkMessageMilestone(friendshipId, count) {
  if (!MESSAGE_MILESTONES.includes(count)) return null;
  if (count === 1) return null; // covered by the `first_message` event

  return record({
    friendshipId,
    type: 'milestone_messages',
    title: `${count.toLocaleString()} messages`,
    description: `You've sent ${count.toLocaleString()} messages to each other.`,
    icon: '💬',
    meta: { count },
    once: `milestone_messages:${count}`,
  });
}

export function listForFriendship(friendshipId, { limit = 100 } = {}) {
  return TimelineEvent.find({ friendshipId })
    .sort({ occurredAt: 1 })
    .limit(limit)
    .lean();
}
