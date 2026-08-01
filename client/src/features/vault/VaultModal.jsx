import { useEffect, useState } from 'react';
import { useAuth } from '../../stores/useAuth.js';
import { useVault } from '../../stores/useVault.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { downloadKeyBackup } from '../../lib/crypto.js';

/**
 * Vault key setup / unlock / restore.
 *
 * The passphrase is deliberately separate from the account password: the
 * server verifies the password, so reusing it would put the one secret that
 * protects the messages within reach of the server at sign-in time.
 */
export function VaultModal({ open, onClose, mode }) {
  const user = useAuth((s) => s.user);
  const create = useVault((s) => s.create);
  const unlock = useVault((s) => s.unlock);
  const restore = useVault((s) => s.restore);

  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [backupText, setBackupText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdBlob, setCreatedBlob] = useState(null);
  const [savedBackup, setSavedBackup] = useState(false);
  const [view, setView] = useState(mode ?? 'unlock');

  // The modal stays mounted while closed, so the `useState` initialiser above
  // only ever runs once. Without this, the caller's requested mode is ignored
  // on every reopen and the user is asked to unlock a key they never created.
  useEffect(() => {
    if (open && mode) setView(mode);
  }, [open, mode]);

  function reset() {
    setPassphrase(''); setConfirm(''); setBackupText('');
    setError(''); setCreatedBlob(null); setSavedBackup(false);
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);

    try {
      if (view === 'create') {
        if (passphrase.length < 10) throw new Error('Use at least 10 characters');
        if (passphrase !== confirm) throw new Error('The two passphrases do not match');
        const { wrapped } = await create(user.id, user.username, passphrase);
        setCreatedBlob(wrapped);
      } else if (view === 'restore') {
        await restore(user.id, backupText, passphrase);
        reset();
      } else {
        await unlock(user.id, passphrase);
        reset();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Post-creation: the key exists but the user has not saved it anywhere yet.
  if (createdBlob) {
    return (
      <Modal
        open
        title="Save your encryption key"
        subtitle="Without this file you cannot read these messages on another device — or after clearing this browser."
        width="max-w-lg"
      >
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-xs leading-relaxed text-secondary">
          <p className="font-medium text-warn">There is no reset for this.</p>
          <p className="mt-1.5">
            Your key is stored only on this device, encrypted with your passphrase.
            Nothing about it is sent to the server, which is exactly why nobody
            else can read your messages — and why nobody, including us, can
            recover it for you.
          </p>
        </div>

        <Button
          onClick={() => { downloadKeyBackup(createdBlob, user.username); setSavedBackup(true); }}
          className="mt-4 w-full"
          variant={savedBackup ? 'outline' : 'primary'}
        >
          {savedBackup ? '✓ Downloaded — keep it somewhere safe' : 'Download key file'}
        </Button>

        <Button onClick={reset} disabled={!savedBackup} size="lg" className="mt-3 w-full">
          Done
        </Button>
      </Modal>
    );
  }

  const copy = {
    create: {
      title: 'Set up encryption',
      subtitle: 'A passphrase only you know. It never leaves this device.',
      action: 'Create my key',
    },
    unlock: {
      title: 'Unlock your messages',
      subtitle: 'Your key is on this device, encrypted with your passphrase.',
      action: 'Unlock',
    },
    restore: {
      title: 'Restore from a key file',
      subtitle: 'Paste the contents of the key file you downloaded.',
      action: 'Restore',
    },
  }[view];

  return (
    <Modal open={open} onClose={reset} title={copy.title} subtitle={copy.subtitle}>
      <form onSubmit={submit} className="space-y-4">
        {view === 'restore' && (
          <Input
            as="textarea"
            rows={5}
            label="Key file contents"
            value={backupText}
            onChange={(e) => setBackupText(e.target.value)}
            placeholder='{ "v": 1, "salt": ... }'
            className="resize-none font-mono text-xs"
            required
          />
        )}

        <Input
          label="Passphrase"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          autoFocus
          required
          hint={view === 'create' ? 'At least 10 characters. Not your account password.' : undefined}
        />

        {view === 'create' && (
          <Input
            label="Confirm passphrase"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            required
          />
        )}

        {error && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
        )}

        <Button type="submit" size="lg" loading={busy} className="w-full">
          {copy.action}
        </Button>
      </form>

      <div className="mt-4 flex justify-center gap-4 text-xs">
        {view !== 'unlock' && (
          <button type="button" className="text-accent hover:underline" onClick={() => setView('unlock')}>
            Unlock instead
          </button>
        )}
        {view !== 'restore' && (
          <button type="button" className="text-accent hover:underline" onClick={() => setView('restore')}>
            Use a key file
          </button>
        )}
        {view !== 'create' && (
          <button type="button" className="text-accent hover:underline" onClick={() => setView('create')}>
            Create a new key
          </button>
        )}
      </div>
    </Modal>
  );
}
