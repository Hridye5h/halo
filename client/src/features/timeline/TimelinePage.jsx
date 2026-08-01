import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../../lib/api.js';
import { shortDate, duration } from '../../lib/format.js';

/**
 * The Friendship Timeline and Shared Memories.
 *
 * Both read from precomputed data — emitted timeline events and denormalised
 * friendship stats — so this page costs two indexed queries regardless of how
 * much history sits behind it.
 */
export function TimelinePage() {
  const { friendshipId } = useParams();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['timeline', friendshipId],
    queryFn: async () => (await api.get(`/friends/${friendshipId}/timeline`)).events,
  });

  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await api.get('/friends')).friends,
  });

  const friend = friends.find((f) => String(f.friendshipId) === String(friendshipId));
  const stats = friend?.stats;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              {friend ? `You and ${friend.user.displayName}` : 'Timeline'}
            </h1>
            {friend?.establishedAt && (
              <p className="mt-1 text-sm text-secondary">
                Friends since {shortDate(friend.establishedAt)}
              </p>
            )}
          </div>
          {friend?.conversationId && (
            <Link
              to={`/chat/${friend.conversationId}`}
              className="rounded-lg px-3 py-1.5 text-xs text-secondary hover:bg-hover hover:text-primary"
            >
              Back to chat
            </Link>
          )}
        </header>

        {stats && (
          <div className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Memory label="Messages" value={stats.messageCount?.toLocaleString() ?? 0} icon="💬" />
            <Memory label="Photos & files" value={stats.mediaShared ?? 0} icon="📷" />
            <Memory label="Voice notes" value={stats.voiceNotes ?? 0} icon="🎤" />
            <Memory
              label="Time talked"
              value={stats.secondsTalked ? duration(stats.secondsTalked) : '—'}
              icon="⏱"
            />
            {stats.gamesPlayed > 0 && (
              <>
                <Memory label="Games played" value={stats.gamesPlayed} icon="♟" />
                <Memory label="Score" value={`${stats.scoreA} – ${stats.scoreB}`} icon="🏆" />
              </>
            )}
            {topEmoji(stats.emojiCounts) && (
              <Memory
                label="Most used"
                value={topEmoji(stats.emojiCounts)}
                icon="😊"
              />
            )}
          </div>
        )}

        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            The story so far
          </h2>

          {isLoading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="mt-4 text-sm text-secondary">
              Nothing here yet. It fills in as things happen.
            </p>
          ) : (
            <ol className="relative mt-5 space-y-5 border-l border-line pl-6">
              {events.map((event, index) => (
                <motion.li
                  key={event._id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.05, 0.4) }}
                  className="relative"
                >
                  <span
                    className="absolute -left-[1.9rem] grid h-6 w-6 place-items-center rounded-full text-xs ring-4 ring-[var(--bg-base)]"
                    style={{ background: 'var(--bg-elevated)' }}
                  >
                    {event.icon}
                  </span>
                  <p className="text-xs text-muted">{shortDate(event.occurredAt)}</p>
                  <p className="mt-0.5 font-medium text-primary">{event.title}</p>
                  {event.description && (
                    <p className="mt-0.5 text-sm text-secondary">{event.description}</p>
                  )}
                </motion.li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function Memory({ label, value, icon }) {
  return (
    <div className="card p-4">
      <span className="text-lg">{icon}</span>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-primary">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function topEmoji(counts) {
  if (!counts) return null;
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}
