import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../../lib/api.js';
import { useAuth } from '../../stores/useAuth.js';
import { useRealtime } from '../../stores/useRealtime.js';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { AddFriendModal } from '../friends/AddFriendModal.jsx';
import { StatusPicker } from '../presence/StatusPicker.jsx';
import {
  lastSeen, presenceOf, flagOf, localTimeIn, isLikelyAsleep,
} from '../../lib/format.js';

export function HomePage() {
  const [adding, setAdding] = useState(false);
  const user = useAuth((s) => s.user);
  const presence = useRealtime((s) => s.presence);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: friends = [], isLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await api.get('/friends')).friends,
  });

  const { data: requests } = useQuery({
    queryKey: ['friendRequests'],
    queryFn: () => api.get('/friends/requests'),
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/conversations')).conversations,
  });

  const unreadByConversation = Object.fromEntries(
    conversations.map((c) => [String(c.id), c.unreadCount]),
  );

  // Live presence overrides whatever the friend list was fetched with.
  const withPresence = friends.map((f) => ({
    ...f,
    liveStatus: presence[f.user.id]?.status ?? f.user.presence?.status ?? 'offline',
    liveCustom: presence[f.user.id]?.customStatus ?? f.user.presence?.customStatus,
  }));

  const online = withPresence.filter((f) => f.liveStatus !== 'offline');
  const offline = withPresence.filter((f) => f.liveStatus === 'offline');
  const incoming = requests?.incoming ?? [];

  async function respond(friendshipId, action) {
    await api.post(`/friends/${friendshipId}/${action}`);
    queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
    queryClient.invalidateQueries({ queryKey: ['friends'] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">
              Hey, {user?.displayName?.split(' ')[0]}
            </h1>
            <p className="mt-1 text-sm text-secondary">
              {online.length > 0
                ? `${online.length} ${online.length === 1 ? 'friend is' : 'friends are'} around right now.`
                : 'Nobody is online right now.'}
            </p>
          </div>
          <Button onClick={() => setAdding(true)} size="sm">＋ Add friend</Button>
        </header>

        <div className="mt-6">
          <StatusPicker />
        </div>

        {incoming.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Friend requests
            </h2>
            <div className="space-y-2">
              {incoming.map((request) => (
                <motion.div
                  key={request.friendshipId}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card flex items-center gap-3 p-3.5"
                >
                  <Avatar user={request.user} size="md" showStatus={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-primary">
                      {request.user.displayName}
                    </p>
                    <p className="truncate text-xs text-muted">@{request.user.username}</p>
                  </div>
                  <Button size="sm" onClick={() => respond(request.friendshipId, 'accept')}>
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => respond(request.friendshipId, 'decline')}
                  >
                    Decline
                  </Button>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="mt-8 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        ) : friends.length === 0 ? (
          <EmptyState onAdd={() => setAdding(true)} code={user?.friendCode} />
        ) : (
          <>
            <FriendGroup
              title={`Online — ${online.length}`}
              friends={online}
              unread={unreadByConversation}
              onOpen={navigate}
            />
            <FriendGroup
              title={`Offline — ${offline.length}`}
              friends={offline}
              unread={unreadByConversation}
              onOpen={navigate}
              dim
            />
          </>
        )}
      </div>

      <AddFriendModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function FriendGroup({ title, friends, unread, onOpen, dim }) {
  if (!friends.length) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="space-y-1.5">
        {friends.map((friend, index) => {
          const presence = presenceOf(friend.liveStatus);
          const count = unread[String(friend.conversationId)] ?? 0;

          return (
            <motion.button
              key={friend.friendshipId}
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.3) }}
              onClick={() => friend.conversationId && onOpen(`/chat/${friend.conversationId}`)}
              className={`group flex w-full items-center gap-3.5 rounded-2xl border border-transparent
                px-3.5 py-3 text-left transition-all
                hover:border-line hover:bg-surface ${dim ? 'opacity-60 hover:opacity-100' : ''}`}
            >
              <Avatar user={friend.user} status={friend.liveStatus} size="lg" />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-medium text-primary">
                  {friend.user.displayName}
                  <span className="text-sm">{flagOf(friend.user.countryCode)}</span>
                </p>
                <p className="truncate text-xs text-secondary">
                  {friend.liveCustom || (
                    friend.liveStatus === 'offline'
                      ? `Last seen ${lastSeen(friend.user.presence?.lastSeenAt).toLowerCase()}`
                      : `${presence.icon} ${presence.label}`
                  )}
                </p>
              </div>

              {localTimeIn(friend.user.timezone) && (
                <span
                  className="hidden text-xs text-muted sm:block"
                  title="Their local time"
                >
                  {isLikelyAsleep(friend.user.timezone) && '🌙 '}
                  {localTimeIn(friend.user.timezone)}
                </span>
              )}

              {count > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-contrast">
                  {count > 99 ? '99+' : count}
                </span>
              )}

              <span className="text-muted opacity-0 transition-opacity group-hover:opacity-100">
                →
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function EmptyState({ onAdd, code }) {
  return (
    <div className="card mt-8 p-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-2xl">
        ◈
      </div>
      <h2 className="mt-4 text-lg font-semibold text-primary">It is quiet in here</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
        Share your friend code with someone you want to keep. There is no search and no
        directory here — the only way anyone reaches you is a code you gave them.
      </p>
      <code className="mt-5 inline-block rounded-xl border border-line bg-inset px-5 py-2.5 font-mono text-lg tracking-[0.2em] text-accent">
        {code}
      </code>
      <div className="mt-5">
        <Button onClick={onAdd}>Add your first friend</Button>
      </div>
      <p className="mt-6 text-xs text-muted">
        Curious how any of this works?{' '}
        <Link to="/settings" className="text-accent hover:underline">Open settings</Link>
      </p>
    </div>
  );
}
