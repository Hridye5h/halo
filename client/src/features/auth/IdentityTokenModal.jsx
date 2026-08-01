import { useState } from 'react';
import { useAuth } from '../../stores/useAuth.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Button } from '../../components/ui/Button.jsx';

/**
 * Shown exactly once, immediately after registration.
 *
 * The token is stored only as a hash, so this really is the only time it can
 * ever be displayed. The confirmation checkbox exists because people click
 * through modals reflexively, and this one is genuinely unrecoverable.
 */
export function IdentityTokenModal() {
  const identityToken = useAuth((s) => s.identityToken);
  const dismiss = useAuth((s) => s.dismissIdentityToken);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!identityToken) return null;

  async function copy() {
    await navigator.clipboard.writeText(identityToken).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob(
      [
        'Halo — Identity Token\n\n',
        `${identityToken}\n\n`,
        'Keep this somewhere safe and private.\n',
        'If you ever lose access to your account, this is what lets you\n',
        'reconnect to your friendships and their full history.\n\n',
        'It cannot log anyone in, and it cannot be shown to you again.\n',
      ],
      { type: 'text/plain' },
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'halo-identity-token.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      open
      title="Save your identity token"
      subtitle="This is the only time it will ever be shown."
      width="max-w-lg"
    >
      <div
        className="rounded-xl border border-accent/30 bg-inset p-4 font-mono text-sm leading-relaxed tracking-wide text-primary"
        style={{ boxShadow: 'var(--glow)' }}
      >
        {identityToken}
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="sm" onClick={copy} className="flex-1">
          {copied ? '✓ Copied' : 'Copy'}
        </Button>
        <Button variant="outline" size="sm" onClick={download} className="flex-1">
          Download
        </Button>
      </div>

      <div className="mt-5 space-y-2.5 text-xs leading-relaxed text-secondary">
        <p>
          <strong className="text-primary">What it does.</strong> If you ever lose this
          account, this token proves a new account is still you — so your friendships and
          everything you have shared come back with you.
        </p>
        <p>
          <strong className="text-primary">What it will not do.</strong> It cannot sign
          anyone in, and your friends still have to approve the reconnection. It is a way
          back, not a key.
        </p>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm text-secondary">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        I have saved it somewhere safe. I understand it cannot be shown again.
      </label>

      <Button
        onClick={dismiss}
        disabled={!confirmed}
        size="lg"
        className="mt-5 w-full"
      >
        Continue
      </Button>
    </Modal>
  );
}
