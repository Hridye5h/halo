import {
  format, formatDistanceToNowStrict, isToday, isYesterday, isThisYear,
} from 'date-fns';

/** All timestamps are UTC on the wire and formatted here, in the viewer's
 *  zone — "8:31 PM" has to mean *their* 8:31 PM. */
export const timeOfDay = (date) => format(new Date(date), 'h:mm a');

export function lastSeen(date) {
  if (!date) return 'Hidden';
  const then = new Date(date);
  const seconds = (Date.now() - then.getTime()) / 1000;

  if (seconds < 60) return 'Just now';
  if (isToday(then)) return `${formatDistanceToNowStrict(then)} ago`;
  if (isYesterday(then)) return `Yesterday ${timeOfDay(then)}`;
  if (isThisYear(then)) return format(then, "d MMM 'at' h:mm a");
  return format(then, 'd MMM yyyy');
}

export function dayLabel(date) {
  const then = new Date(date);
  if (isToday(then)) return 'Today';
  if (isYesterday(then)) return 'Yesterday';
  if (isThisYear(then)) return format(then, 'EEEE, d MMMM');
  return format(then, 'd MMMM yyyy');
}

export const shortDate = (date) => format(new Date(date), 'd MMM yyyy');
export const monthDay = (date) => format(new Date(date), 'd MMM');

export function joinedLabel(date) {
  return `Joined ${format(new Date(date), 'MMMM yyyy')}`;
}

export function duration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const PRESENCE = {
  online: { label: 'Online', dot: '#3ecf8e', icon: '🟢' },
  away: { label: 'Away', dot: '#f5a623', icon: '🟡' },
  offline: { label: 'Offline', dot: '#6b6b85', icon: '⚫' },
  sleeping: { label: 'Sleeping', dot: '#7c5cff', icon: '🌙' },
  studying: { label: 'Studying', dot: '#5b8cff', icon: '🎓' },
  playing: { label: 'Playing', dot: '#4ade80', icon: '♟' },
};

export const presenceOf = (status) => PRESENCE[status] ?? PRESENCE.offline;

/** Country flags from an ISO code, without shipping an image set: regional
 *  indicator symbols are just codepoint arithmetic. */
export function flagOf(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  return String.fromCodePoint(
    ...countryCode.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)),
  );
}

/* ---------------------------------------------------------------------------
 * Their time, not yours.
 *
 * Across a large offset, "are they around?" is really a question about what
 * time it is where they are. Presence alone cannot answer it — someone can be
 * offline at 2pm and awake, or online at 4am and shouldn't be.
 * ------------------------------------------------------------------------ */

export function localTimeIn(timezone) {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', timeZone: timezone,
    }).format(new Date());
  } catch {
    // An unknown or malformed zone must not crash the header it renders in.
    return null;
  }
}

/**
 * Hours between the viewer and a target zone, signed.
 *
 * Rounded to the nearest half hour, not the nearest hour: India is UTC+5:30,
 * Nepal is +5:45, parts of Australia are +9:30. Rounding to whole hours would
 * tell a user in Delhi they are "11h" from Mexico City when the answer is
 * 11.5, and being half an hour wrong about someone's bedtime defeats the
 * purpose.
 */
export function hoursApart(timezone) {
  if (!timezone) return null;
  try {
    const now = new Date();
    const there = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const here = new Date(now.toLocaleString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
    return Math.round(((there - here) / 36e5) * 2) / 2;
  } catch {
    return null;
  }
}

/** "11.5h" but "11h" — no trailing .0 for whole-hour offsets. */
export function formatHourGap(diff) {
  const magnitude = Math.abs(diff);
  const rendered = Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(1);
  return `${rendered}h ${diff > 0 ? 'ahead' : 'behind'}`;
}

export function timezoneLabel(timezone) {
  const time = localTimeIn(timezone);
  if (!time) return null;

  const diff = hoursApart(timezone);
  if (diff === null || diff === 0) return `${time} their time`;

  return `${time} their time · ${formatHourGap(diff)}`;
}

/** Rough sleeping-hours check, so the UI can hint before you ring someone at 4am. */
export function isLikelyAsleep(timezone) {
  if (!timezone) return false;
  try {
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: timezone,
    }).format(new Date()));
    return hour >= 23 || hour < 7;
  } catch {
    return false;
  }
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/** Deterministic colour per user, so an avatar-less friend still has a stable
 *  identity in the list rather than a grey blob. */
export function colorFromId(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 65% 55%)`;
}
