import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../stores/useAuth.js';
import { useRealtime } from '../stores/useRealtime.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import { presenceOf } from '../lib/format.js';

const LINKS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/friends', label: 'Friends', icon: '👥' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Sidebar() {
  const user = useAuth((s) => s.user);
  const connected = useRealtime((s) => s.connected);
  const presence = useRealtime((s) => s.presence);
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    refetchInterval: 60_000,
  });

  // Own status is local intent first: the user should see their own change
  // instantly, not after the server echoes it back.
  const myStatus = presence[user?.id]?.status ?? user?.presence?.status ?? 'online';
  const unread = data?.unreadCount ?? 0;

  return (
    <aside className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface/50 py-4">
      <div
        className="grid h-10 w-10 place-items-center rounded-xl text-lg"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        title="Halo"
      >
        ◈
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            title={link.label}
            className={({ isActive }) => `relative grid h-11 w-11 place-items-center rounded-xl
              text-lg transition-colors
              ${isActive
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-hover hover:text-primary'}`}
          >
            {link.icon}
            {link.to === '/friends' && unread > 0 && (
              <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => navigate('/profile')}
        title={`${user?.displayName} · ${presenceOf(myStatus).label}`}
        className="rounded-full transition-transform hover:scale-105"
      >
        <Avatar user={user} status={myStatus} size="md" />
      </button>

      <span
        className="mt-2 h-1.5 w-1.5 rounded-full transition-colors"
        style={{ background: connected ? 'var(--success)' : 'var(--warn)' }}
        title={connected ? 'Connected' : 'Reconnecting…'}
      />
    </aside>
  );
}
