import { create } from 'zustand';
import { api } from '../lib/api.js';
import * as vault from '../lib/crypto.js';

/**
 * Vault key state.
 *
 * The unwrapped private key lives ONLY in this store — in memory, for the life
 * of the tab. It is never written to disk unwrapped, never sent anywhere, and
 * disappears on refresh, which is why `unlock` exists as a separate step from
 * signing in.
 */
export const useVault = create((set, get) => ({
  privateKey: null,
  hasWrappedKey: false,
  status: 'unknown', // unknown | absent | locked | unlocked
  conversationKeys: new Map(),

  /** Called after auth resolves — decides which of the three states we're in. */
  init(userId) {
    const wrapped = vault.loadWrappedKey(userId);
    set({
      hasWrappedKey: !!wrapped,
      status: wrapped ? 'locked' : 'absent',
      privateKey: null,
      conversationKeys: new Map(),
    });
  },

  /**
   * Creates an identity keypair and publishes the public half.
   *
   * The passphrase never leaves the device; it only derives the wrapping key.
   * Losing it means losing every encrypted message, so the UI forces a backup
   * download before this is considered done.
   */
  async create(userId, username, passphrase) {
    const keyPair = await vault.generateIdentityKeyPair();
    const publicKey = await vault.exportPublicKey(keyPair);
    const wrapped = await vault.wrapPrivateKey(keyPair.privateKey, passphrase);

    vault.storeWrappedKey(userId, wrapped);
    await api.put('/users/me/keys', { publicKey });

    set({ privateKey: keyPair.privateKey, hasWrappedKey: true, status: 'unlocked' });
    return { wrapped, publicKey, username };
  },

  async unlock(userId, passphrase) {
    const wrapped = vault.loadWrappedKey(userId);
    if (!wrapped) throw new Error('No key on this device');

    // A wrong passphrase fails GCM authentication rather than yielding a
    // garbage key, so this genuinely verifies the passphrase.
    const privateKey = await vault.unwrapPrivateKey(wrapped, passphrase)
      .catch(() => { throw new Error('That passphrase is not right'); });

    set({ privateKey, status: 'unlocked', conversationKeys: new Map() });
  },

  /** Restores a key from a downloaded backup, for a second device. */
  async restore(userId, backupText, passphrase) {
    const blob = vault.parseKeyBackup(backupText);
    if (!blob) throw new Error('That does not look like a vault key file');

    const privateKey = await vault.unwrapPrivateKey(blob, passphrase)
      .catch(() => { throw new Error('That passphrase is not right for this key file') });

    vault.storeWrappedKey(userId, blob);
    set({ privateKey, hasWrappedKey: true, status: 'unlocked', conversationKeys: new Map() });
  },

  lock() {
    set({ privateKey: null, status: 'locked', conversationKeys: new Map() });
  },

  /** Derives (and caches) the AES key for one conversation. */
  async keyFor(conversationId, theirPublicKeyBase64) {
    const cached = get().conversationKeys.get(String(conversationId));
    if (cached) return cached;

    const { privateKey } = get();
    if (!privateKey) throw new Error('Vault is locked');
    if (!theirPublicKeyBase64) throw new Error('That person has not set up encryption yet');

    const theirPublicKey = await vault.importPublicKey(theirPublicKeyBase64);
    const key = await vault.deriveConversationKey(privateKey, theirPublicKey, conversationId);

    const next = new Map(get().conversationKeys);
    next.set(String(conversationId), key);
    set({ conversationKeys: next });

    return key;
  },

  /** Drops a cached conversation key — used when a friend rotates theirs. */
  forget(conversationId) {
    const next = new Map(get().conversationKeys);
    next.delete(String(conversationId));
    set({ conversationKeys: next });
  },
}));
