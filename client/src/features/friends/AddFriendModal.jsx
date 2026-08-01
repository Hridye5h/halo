import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useAuth } from '../../stores/useAuth.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { flagOf } from '../../lib/format.js';

export function AddFriendModal({ open, onClose }) {
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const myCode = useAuth((s) => s.user?.friendCode);
  const queryClient = useQueryClient();

  function reset() {
    setCode(''); setFound(null); setError(''); setSent(false);
    onClose();
  }

  async function lookup(e) {
    e.preventDefault();
    setError(''); setFound(null); setBusy(true);
    try {
      const data = await api.post('/friends/lookup', { friendCode: code });
      setFound(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest() {
    setBusy(true); setError('');
    try {
      const result = await api.post('/friends/request', { friendCode: code });
      setSent(true);
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
      if (result.accepted) setTimeout(reset, 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="Add a friend"
      subtitle="Friend codes are the only way in. There is no search here, on purpose."
    >
      <div className="rounded-xl border border-line bg-inset p-4">
        <p className="text-xs text-secondary">Your friend code</p>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <code className="font-mono text-xl tracking-[0.2em] text-accent">{myCode}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigator.clipboard.writeText(myCode ?? '')}
          >
            Copy
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          It never changes — not if you rename yourself, not if you change your email.
        </p>
      </div>

      <form onSubmit={lookup} className="mt-5 space-y-3">
        <Input
          label="Their friend code"
          value={code}
          onChange={(e) => { setCode(e.target.value); setFound(null); setSent(false); }}
          placeholder="7JXK-92QF"
          className="font-mono tracking-widest uppercase"
          error={error}
        />
        {!found && (
          <Button type="submit" loading={busy} disabled={!code.trim()} className="w-full">
            Look up
          </Button>
        )}
      </form>

      {found && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-inset p-3.5">
          <Avatar user={found} size="lg" showStatus={false} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-primary">
              {found.displayName} {flagOf(found.countryCode)}
            </p>
            <p className="truncate text-xs text-muted">@{found.username}</p>
          </div>
          <Button onClick={sendRequest} loading={busy} disabled={sent} size="sm">
            {sent ? '✓ Sent' : 'Send request'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
