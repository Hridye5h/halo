import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../stores/useAuth.js';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Input.jsx';
import {
  THEMES, CUSTOM_KEYS, applyTheme, validateCustomTheme, encodeTheme, decodeTheme,
} from '../../lib/theme.js';

export function SettingsPage() {
  const user = useAuth((s) => s.user);
  const saveSettings = useAuth((s) => s.saveSettings);
  const settings = user?.settings ?? {};

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Settings</h1>

        <Section title="Theme" hint="Changes apply instantly and follow you to every device.">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {THEMES.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                active={settings.theme === theme.id}
                onSelect={() => saveSettings({ theme: theme.id })}
              />
            ))}
          </div>
          <ThemeStudio />
        </Section>

        <Section title="Appearance">
          <Toggle
            label="Compact density"
            hint="Tighter spacing, more messages on screen."
            checked={settings.density === 'compact'}
            onChange={(v) => saveSettings({ density: v ? 'compact' : 'comfortable' })}
          />
          <Toggle
            label="Reduce motion"
            hint="Turns off animations and transitions."
            checked={!!settings.reducedMotion}
            onChange={(v) => saveSettings({ reducedMotion: v })}
          />
        </Section>

        <Section title="Privacy">
          <Toggle
            label="Invisible mode"
            hint="You appear offline to everyone, but you can still read and send."
            checked={!!settings.invisible}
            onChange={(v) => saveSettings({ invisible: v })}
          />
          <Toggle
            label="Hide last seen"
            hint="Friends will not see when you were last around."
            checked={!!settings.hideLastSeen}
            onChange={(v) => saveSettings({ hideLastSeen: v })}
          />
        </Section>

        <Section title="Notifications">
          <Toggle
            label="Message notifications"
            checked={settings.notifications?.messages !== false}
            onChange={(v) => saveSettings({ notifications: { messages: v } })}
          />
          <Toggle
            label="Presence notifications"
            hint="When a friend comes online."
            checked={settings.notifications?.presence !== false}
            onChange={(v) => saveSettings({ notifications: { presence: v } })}
          />
          <Toggle
            label="Sounds"
            checked={settings.notifications?.sounds !== false}
            onChange={(v) => saveSettings({ notifications: { sounds: v } })}
          />
        </Section>

        <Section title="Your friend code" hint="Permanent. It survives every other change.">
          <code className="inline-block rounded-xl border border-line bg-inset px-5 py-3 font-mono text-lg tracking-[0.2em] text-accent">
            {user?.friendCode}
          </code>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="mt-9">
      <h2 className="text-sm font-semibold text-primary">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3.5 space-y-2">{children}</div>
    </section>
  );
}

function ThemeCard({ theme, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`card relative overflow-hidden p-3 text-left transition-all hover:scale-[1.02]
        ${active ? 'ring-2 ring-accent' : ''}`}
    >
      <div className="flex gap-1">
        {theme.swatch.map((color) => (
          <span
            key={color}
            className="h-8 flex-1 rounded-md"
            style={{ background: color }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs font-medium text-primary">{theme.name}</p>
      {active && <span className="absolute right-2 top-2 text-xs text-accent">✓</span>}
    </button>
  );
}

/**
 * Custom theme authoring.
 *
 * This exists because of the token layer: a theme is just values for the same
 * ~24 variables every component already reads, so authoring one needs no new
 * rendering path at all.
 */
function ThemeStudio() {
  const user = useAuth((s) => s.user);
  const saveSettings = useAuth((s) => s.saveSettings);
  const patchUser = useAuth((s) => s.patchUser);

  const [open, setOpen] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [colors, setColors] = useState(() =>
    user?.settings?.customTheme?.colors ?? readCurrentColors());
  const [name, setName] = useState(user?.settings?.customTheme?.name ?? 'My theme');

  const validation = validateCustomTheme(colors);

  function readCurrentColors() {
    const computed = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      CUSTOM_KEYS.map((key) => [key, computed.getPropertyValue(`--${key}`).trim()]),
    );
  }

  function preview(next) {
    setColors(next);
    // Live preview without saving: apply straight to the DOM.
    applyTheme({
      theme: 'custom',
      customTheme: { name, colors: next },
      density: user?.settings?.density,
      reducedMotion: user?.settings?.reducedMotion,
    });
  }

  async function save() {
    const customTheme = { name, colors };
    patchUser({ settings: { theme: 'custom', customTheme } });
    await saveSettings({ theme: 'custom', customTheme });
  }

  function importTheme() {
    const decoded = decodeTheme(importCode);
    if (!decoded) return;
    setName(decoded.name);
    preview({ ...colors, ...decoded.colors });
    setImportCode('');
  }

  // Only the colour keys worth exposing — gradients and shadows are derived.
  const EDITABLE = [
    ['bg-base', 'Background'],
    ['bg-surface', 'Panels'],
    ['bg-elevated', 'Raised surfaces'],
    ['bg-inset', 'Inputs'],
    ['text-primary', 'Text'],
    ['text-secondary', 'Secondary text'],
    ['accent', 'Accent'],
    ['accent-contrast', 'Text on accent'],
    ['line', 'Borders'],
  ];

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Close theme studio' : '🎨 Make your own'}
      </Button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="card mt-3 overflow-hidden p-4"
        >
          <Input label="Theme name" value={name} onChange={(e) => setName(e.target.value)} />

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {EDITABLE.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2.5 text-xs text-secondary">
                <input
                  type="color"
                  value={normalizeHex(colors[key])}
                  onChange={(e) => preview({ ...colors, [key]: e.target.value })}
                  className="h-8 w-8 cursor-pointer rounded-lg border border-line bg-transparent"
                />
                {label}
              </label>
            ))}
          </div>

          {!validation.ok && (
            <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
              <p className="font-medium text-warn">Hard to read</p>
              <ul className="mt-1 space-y-0.5 text-secondary">
                {validation.problems.map((p) => (
                  <li key={p.label}>
                    {p.label}: {p.ratio}:1 — needs {p.required}:1
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={!validation.ok}>
              Save theme
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(encodeTheme({ name, colors }))}
            >
              Copy share code
            </Button>
          </div>

          <div className="mt-4 flex gap-2 border-t border-line pt-4">
            <input
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              placeholder="Paste a theme code…"
              className="flex-1 rounded-lg border border-line bg-inset px-3 py-2 text-xs text-primary placeholder:text-muted focus:outline-none"
            />
            <Button size="sm" variant="ghost" onClick={importTheme} disabled={!importCode.trim()}>
              Import
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** <input type="color"> only accepts #rrggbb, so anything else gets a fallback. */
function normalizeHex(value = '') {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((c) => c + c).join('')}`;
  }
  return '#000000';
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm text-primary">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors
          ${checked ? 'bg-accent' : 'bg-line-strong'}`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          style={{ left: checked ? '1.375rem' : '0.125rem' }}
        />
      </span>
    </label>
  );
}
