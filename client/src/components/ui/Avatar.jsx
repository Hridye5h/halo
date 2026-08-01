import { initials, colorFromId, presenceOf } from '../../lib/format.js';

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-24 w-24 text-3xl',
};

const DOT_SIZES = { sm: 'h-2.5 w-2.5', md: 'h-3 w-3', lg: 'h-3.5 w-3.5', xl: 'h-5 w-5' };

export function Avatar({ user, size = 'md', status, showStatus = true, className = '' }) {
  if (!user) return null;
  const presence = presenceOf(status ?? user.presence?.status);

  return (
    <div className={`relative shrink-0 ${className}`}>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className={`${SIZES[size]} rounded-full object-cover ring-1 ring-line`}
        />
      ) : (
        <div
          className={`${SIZES[size]} grid place-items-center rounded-full font-semibold text-white ring-1 ring-line`}
          style={{ background: colorFromId(user.id ?? user.username) }}
        >
          {initials(user.displayName ?? user.username)}
        </div>
      )}

      {showStatus && (
        <span
          title={presence.label}
          className={`absolute -bottom-0.5 -right-0.5 ${DOT_SIZES[size]} rounded-full ring-2 ring-surface`}
          style={{ background: presence.dot }}
        />
      )}
    </div>
  );
}
