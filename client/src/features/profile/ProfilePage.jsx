import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../../lib/api.js';
import { useAuth } from '../../stores/useAuth.js';
import { useRealtime } from '../../stores/useRealtime.js';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Input.jsx';
import {
  flagOf, joinedLabel, lastSeen, presenceOf, localTimeIn, hoursApart, formatHourGap,
} from '../../lib/format.js';
import { keyFingerprint } from '../../lib/crypto.js';

export function ProfilePage() {
  const { userId } = useParams();
  const me = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const isSelf = !userId || userId === me?.id;

  const { data: user } = useQuery({
    queryKey: ['user', userId ?? 'me'],
    queryFn: async () => (await api.get(`/users/${userId}`)).user,
    enabled: !isSelf,
  });

  const profile = isSelf ? me : user;
  const presence = useRealtime((s) => s.presence[profile?.id]);
  const status = presence?.status ?? profile?.presence?.status ?? 'offline';

  const [editing, setEditing] = useState(false);

  if (!profile) {
    return <div className="grid h-full place-items-center text-sm text-muted">Loading…</div>;
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div
        className="h-40 w-full"
        style={{
          background: profile.bannerUrl
            ? `url(${profile.bannerUrl}) center/cover`
            : 'var(--app-bg)',
        }}
      />

      <div className="mx-auto max-w-2xl px-8 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="-mt-12"
        >
          <div className="flex items-end justify-between gap-4">
            <div className="rounded-full ring-4 ring-[var(--bg-base)]">
              <Avatar user={profile} status={status} size="xl" />
            </div>
            {isSelf && (
              <div className="flex gap-2 pb-2">
                <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Cancel' : 'Edit profile'}
                </Button>
                <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
              </div>
            )}
          </div>

          {editing ? (
            <EditProfile onDone={() => setEditing(false)} />
          ) : (
            <>
              <div className="mt-4">
                <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-primary">
                  {profile.displayName}
                  <span className="text-xl">{flagOf(profile.countryCode)}</span>
                </h1>
                <p className="text-sm text-muted">
                  @{profile.username}
                  {profile.pronouns && ` · ${profile.pronouns}`}
                </p>
              </div>

              <div className="mt-3 flex items-center gap-2 text-sm text-secondary">
                <span>{presenceOf(status).icon}</span>
                <span>
                  {presence?.customStatus || profile.presence?.customStatus
                    || (status === 'offline'
                      ? `Last seen ${lastSeen(profile.presence?.lastSeenAt).toLowerCase()}`
                      : presenceOf(status).label)}
                </span>
              </div>

              {profile.bio && (
                <p className="mt-5 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-secondary">
                  {profile.bio}
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-2">
                {profile.badges?.map((badge) => (
                  <span
                    key={badge.key}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-secondary"
                    title={`Earned ${new Date(badge.awardedAt).toLocaleDateString()}`}
                  >
                    <span>{badge.icon}</span>
                    {badge.label}
                  </span>
                ))}
              </div>

              <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Joined" value={joinedLabel(profile.joinedAt).replace('Joined ', '')} />
                {localTimeIn(profile.timezone) && (
                  <Stat
                    label={isSelf ? 'Your time' : timeDiffLabel(profile.timezone)}
                    value={localTimeIn(profile.timezone)}
                  />
                )}
                {isSelf && <Stat label="Friend code" value={profile.friendCode} mono />}
                {profile.chess?.chesscomUsername && (
                  <Stat label="Chess.com" value={profile.chess.chesscomUsername} />
                )}
                {profile.chess?.lichessUsername && (
                  <Stat label="Lichess" value={profile.chess.lichessUsername} />
                )}
              </dl>

              <KeyFingerprint
                publicKey={profile.publicKey}
                isSelf={isSelf}
                name={profile.displayName}
              />
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/**
 * Safety number.
 *
 * Both people should see the same string. If they do not, someone is sitting
 * between them — which is precisely the attack that strong ciphers cannot
 * detect on their own.
 */
function KeyFingerprint({ publicKey, isSelf, name }) {
  const [fingerprint, setFingerprint] = useState(null);

  useEffect(() => {
    let cancelled = false;
    keyFingerprint(publicKey).then((value) => { if (!cancelled) setFingerprint(value); });
    return () => { cancelled = true; };
  }, [publicKey]);

  if (!publicKey) {
    return (
      <div className="card mt-6 p-4">
        <p className="text-xs text-muted">Encryption key</p>
        <p className="mt-1 text-sm text-secondary">
          {isSelf
            ? 'Not set up yet. Open any conversation and choose Encrypt.'
            : `${name} has not set up encryption yet.`}
        </p>
      </div>
    );
  }

  return (
    <div className="card mt-6 p-4">
      <p className="text-xs text-muted">
        {isSelf ? 'Your safety number' : 'Safety number'}
      </p>
      <code className="mt-1.5 block font-mono text-sm tracking-wider text-primary">
        {fingerprint ?? '····'}
      </code>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {isSelf
          ? 'Read this out to a friend over a call. If it matches what they see on your profile, nobody is intercepting your encrypted messages.'
          : `Compare this with ${name} over a call or in person. If it matches, your encrypted messages are going only to them.`}
      </p>
    </div>
  );
}

function timeDiffLabel(timezone) {
  const diff = hoursApart(timezone);
  if (diff === null || diff === 0) return 'Their time';
  return `Their time · ${formatHourGap(diff)}`;
}

function Stat({ label, value, mono }) {
  return (
    <div className="card p-3.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm text-primary ${mono ? 'font-mono tracking-wider' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function EditProfile({ onDone }) {
  const me = useAuth((s) => s.user);
  const saveProfile = useAuth((s) => s.saveProfile);
  const [form, setForm] = useState({
    displayName: me.displayName ?? '',
    bio: me.bio ?? '',
    countryCode: me.countryCode ?? '',
    pronouns: me.pronouns ?? '',
    avatarUrl: me.avatarUrl ?? '',
    bannerUrl: me.bannerUrl ?? '',
    chesscomUsername: me.chess?.chesscomUsername ?? '',
    lichessUsername: me.chess?.lichessUsername ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { chesscomUsername, lichessUsername, ...rest } = form;
      await saveProfile({ ...rest, chess: { chesscomUsername, lichessUsername } });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-6 space-y-4">
      <Input label="Display name" value={form.displayName} onChange={set('displayName')} required />
      <Input
        as="textarea"
        rows={4}
        label="Bio"
        value={form.bio}
        onChange={set('bio')}
        hint={`${form.bio.length}/500`}
        maxLength={500}
        placeholder="Anything you want people to know."
        className="resize-none"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Country code"
          value={form.countryCode}
          onChange={set('countryCode')}
          maxLength={2}
          placeholder="IN"
          hint={form.countryCode ? flagOf(form.countryCode) : 'Two letters, e.g. IN'}
          className="uppercase"
        />
        <Input label="Pronouns" value={form.pronouns} onChange={set('pronouns')} placeholder="they/them" />
      </div>
      <Input label="Avatar URL" value={form.avatarUrl} onChange={set('avatarUrl')} placeholder="https://…" />
      <Input label="Banner URL" value={form.bannerUrl} onChange={set('bannerUrl')} placeholder="https://…" />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Chess.com" value={form.chesscomUsername} onChange={set('chesscomUsername')} />
        <Input label="Lichess" value={form.lichessUsername} onChange={set('lichessUsername')} />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" loading={busy}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
