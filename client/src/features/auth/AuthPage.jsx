import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../stores/useAuth.js';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Input.jsx';

export function AuthPage() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    identifier: '', username: '', email: '', password: '', displayName: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login({ identifier: form.identifier, password: form.password });
      } else {
        await register({
          username: form.username,
          email: form.email,
          password: form.password,
          displayName: form.displayName || form.username,
        });
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-screen place-items-center overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <div
            className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl"
            style={{ background: 'var(--accent-soft)', boxShadow: 'var(--glow)' }}
          >
            ◈
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-primary">
            {mode === 'login' ? 'Welcome back' : 'Make a place of your own'}
          </h1>
          <p className="mt-1.5 text-sm text-secondary">
            {mode === 'login'
              ? 'Your conversations are waiting.'
              : 'A private space for the people who matter.'}
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {mode === 'login' ? (
            <Input
              label="Username or email"
              value={form.identifier}
              onChange={set('identifier')}
              autoComplete="username"
              autoFocus
              required
            />
          ) : (
            <>
              <Input
                label="Username"
                value={form.username}
                onChange={set('username')}
                hint="Letters, numbers and underscores."
                autoComplete="username"
                autoFocus
                required
              />
              <Input
                label="Display name"
                value={form.displayName}
                onChange={set('displayName')}
                placeholder="What friends should see"
                autoComplete="nickname"
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={set('email')}
                autoComplete="email"
                required
              />
            </>
          )}

          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={set('password')}
            hint={mode === 'register' ? 'At least 8 characters.' : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}

          <Button type="submit" size="lg" loading={busy} className="w-full">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-secondary">
          {mode === 'login' ? "Don't have an account?" : 'Already have one?'}{' '}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
