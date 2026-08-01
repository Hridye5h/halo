import { create } from 'zustand';
import { api, setAccessToken, setUnauthorizedHandler } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';
import { applyTheme } from '../lib/theme.js';
import { useVault } from './useVault.js';

export const useAuth = create((set, get) => ({
  user: null,
  status: 'loading', // loading | authed | anon
  identityToken: null, // held only until the user confirms they saved it

  /**
   * Restores a session on page load using the refresh cookie.
   *
   * The access token was in memory and is gone after a reload — that is the
   * tradeoff for not putting it in localStorage, and this is what pays it back.
   */
  async bootstrap() {
    try {
      const data = await api.refresh();
      if (!data?.user) {
        set({ status: 'anon', user: null });
        return;
      }
      applyTheme(data.user.settings ?? {});
      set({ user: data.user, status: 'authed' });
      useVault.getState().init(data.user.id);
      await connectSocket();
      get().syncTimezone();
    } catch {
      set({ status: 'anon', user: null });
    }
  },

  /**
   * Keeps the stored IANA zone matching the device.
   *
   * Silently, and only when it actually changed — this is what powers "it is
   * 3:40am for them", and asking a user to pick their timezone from a dropdown
   * to get that is a worse experience than just knowing.
   */
  async syncTimezone() {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timezone || timezone === get().user?.timezone) return;

      const data = await api.patch('/users/me', { timezone });
      set({ user: { ...get().user, ...data.user } });
    } catch {
      // Cosmetic — never block startup on it.
    }
  },

  async login(credentials) {
    const data = await api.post('/auth/login', credentials);
    setAccessToken(data.accessToken);
    applyTheme(data.user.settings ?? {});
    set({ user: data.user, status: 'authed' });
    useVault.getState().init(data.user.id);
    await connectSocket();
    get().syncTimezone();
    return data.user;
  },

  async register(details) {
    const data = await api.post('/auth/register', details);
    setAccessToken(data.accessToken);
    applyTheme(data.user.settings ?? {});
    // The identity token is shown once and never again — the UI must surface
    // it before anything else can happen.
    set({ user: data.user, status: 'authed', identityToken: data.identityToken });
    useVault.getState().init(data.user.id);
    await connectSocket();
    get().syncTimezone();
    return data.user;
  },

  dismissIdentityToken() {
    set({ identityToken: null });
  },

  async logout() {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    disconnectSocket();
    // Drop the in-memory private key. The wrapped copy stays on the device so
    // the next sign-in only needs the passphrase, not the backup file.
    useVault.getState().lock();
    set({ user: null, status: 'anon', identityToken: null });
  },

  /** Optimistic local patch — the server is the source of truth, but the UI
   *  should not wait a round trip to show a theme change. */
  patchUser(patch) {
    const user = get().user;
    if (!user) return;
    const next = { ...user, ...patch, settings: { ...user.settings, ...patch.settings } };
    applyTheme(next.settings ?? {});
    set({ user: next });
  },

  async saveSettings(settings) {
    get().patchUser({ settings });
    const data = await api.patch('/users/me/settings', settings);
    get().patchUser({ settings: data.settings });
  },

  async saveProfile(profile) {
    const data = await api.patch('/users/me', profile);
    set({ user: { ...get().user, ...data.user } });
    return data.user;
  },
}));

// A refresh failure anywhere in the app means the session is genuinely over.
setUnauthorizedHandler(() => {
  disconnectSocket();
  useAuth.setState({ user: null, status: 'anon' });
});
