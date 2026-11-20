/**
 * Which shell the web app runs in, and the few platform services that differ between them:
 * protected storage for sign-in tokens, ordinary storage for the server list, opening links, and
 * saving/sharing files.
 *
 * - web: the browser (cookies + CSRF, same origin). Nothing here is used.
 * - android / ios: Capacitor. Tokens in Android Keystore / iOS Keychain (secure-storage plugin).
 * - windows: Tauri v2. Tokens in Windows Credential Manager (DPAPI) through the app's Rust commands.
 *
 * Native plugins are loaded on demand so the browser bundle doesn't carry them.
 */

export type Platform = 'web' | 'android' | 'ios' | 'windows';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}
type W = Window & { Capacitor?: CapacitorGlobal; __TAURI_INTERNALS__?: unknown; __nbPlatform?: Platform };

export function platform(): Platform {
  const w = window as W;
  if (w.__nbPlatform) return w.__nbPlatform;
  let p: Platform = 'web';
  if (w.__TAURI_INTERNALS__) p = 'windows';
  else if (w.Capacitor?.isNativePlatform?.()) p = w.Capacitor.getPlatform?.() === 'ios' ? 'ios' : 'android';
  w.__nbPlatform = p;
  return p;
}

export const isNative = () => platform() !== 'web';
export const isMobile = () => platform() === 'android' || platform() === 'ios';

/** Version of this app build, sent to the server so the account page can name the device. */
export const APP_VERSION = '3.0.0-alpha.7';

export function appLabel(): string {
  const p = platform();
  const name = p === 'android' ? 'Android' : p === 'ios' ? (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : p === 'windows' ? 'Windows' : 'Web';
  return `Noteboard ${name} ${APP_VERSION}`;
}

/**
 * Plain http:// servers are allowed only in development builds (built with
 * `--configuration native-dev`), and the app then shows a warning. Release builds need https.
 */
declare const NB_ALLOW_HTTP: boolean | undefined;
export const httpAllowed = (): boolean => (typeof NB_ALLOW_HTTP !== 'undefined' ? !!NB_ALLOW_HTTP : false);

// ---------- protected storage (sign-in tokens) ----------

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

let secrets: Promise<SecretStore> | null = null;

export function secretStore(): Promise<SecretStore> {
  secrets ??= makeSecretStore();
  return secrets;
}

async function makeSecretStore(): Promise<SecretStore> {
  const p = platform();
  if (p === 'android' || p === 'ios') {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.setKeyPrefix('nb_');
    await SecureStorage.setSynchronize(false); // keep tokens on this device (no iCloud Keychain sync)
    return {
      get: async (k) => {
        const v = await SecureStorage.get(k);
        return typeof v === 'string' ? v : null;
      },
      set: (k, v) => SecureStorage.set(k, v),
      remove: async (k) => {
        await SecureStorage.remove(k);
      },
    };
  }
  if (p === 'windows') {
    const { invoke } = await import('@tauri-apps/api/core');
    return {
      get: (k) => invoke<string | null>('secret_get', { key: k }),
      set: (k, v) => invoke<void>('secret_set', { key: k, value: v }),
      remove: (k) => invoke<void>('secret_remove', { key: k }),
    };
  }
  // The browser never stores tokens (it uses an HttpOnly cookie). Keep them in memory only.
  const mem = new Map<string, string>();
  return { get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) };
}

// ---------- ordinary storage (server list; nothing secret) ----------

export async function prefGet(key: string): Promise<string | null> {
  if (isMobile()) {
    const { Preferences } = await import('@capacitor/preferences');
    return (await Preferences.get({ key })).value;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function prefSet(key: string, value: string): Promise<void> {
  if (isMobile()) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

// ---------- links and files ----------

/** Opens an address in the system browser (the admin panel, help links). */
export async function openExternal(url: string): Promise<void> {
  const p = platform();
  if (p === 'windows') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external', { url });
    return;
  }
  if (isMobile()) {
    const { AppLauncher } = await import('@capacitor/app-launcher');
    await AppLauncher.openUrl({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Hands a file to the person: the share sheet on phones (save to Files, Drive, e-mail …), a save
 * dialog on Windows, a download in the browser. Returns where it went, if known.
 */
export async function saveFile(name: string, data: Blob): Promise<string | null> {
  const p = platform();
  if (isMobile()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const w = await Filesystem.writeFile({ path: name, data: await blobToBase64(data), directory: Directory.Cache });
    await Share.share({ title: name, files: [w.uri] }).catch(() => undefined);
    return w.uri;
  }
  if (p === 'windows') {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('save_file', { name, data: await blobToBase64(data) });
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

/** Copies text to the clipboard through the native clipboard where there is one. */
export async function copyText(text: string): Promise<void> {
  if (isMobile()) {
    const { Clipboard } = await import('@capacitor/clipboard');
    await Clipboard.write({ string: text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
