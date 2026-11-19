/**
 * Where a client keeps its boards. The web app uses IndexedDB; the desktop (Tauri) and mobile
 * (Capacitor) shells and the server sync layer plug in their own adapters behind the same interface.
 */
import { InjectionToken } from '@angular/core';
import { Store } from '@noteboard/board-model';
import { Prefs } from './prefs';

export interface StorageAdapter {
  readonly label: string;
  load(): Promise<{ store: Store | null; prefs: Prefs | null }>;
  saveStore(store: Store): Promise<void>;
  savePrefs(prefs: Prefs): Promise<void>;
  putImage(name: string, data: Blob): Promise<void>;
  /** An address the page can show, or null when the picture isn't stored here. */
  imageUrl(name: string): Promise<string | null>;
  listImages(): Promise<string[]>;
}

export const STORAGE = new InjectionToken<StorageAdapter>('noteboard storage');

/** Keeps everything in memory (tests, and as a fallback when IndexedDB is unavailable). */
export class MemoryStorage implements StorageAdapter {
  readonly label = 'this browser tab only (not saved)';
  store: Store | null = null;
  prefs: Prefs | null = null;
  images = new Map<string, Blob>();
  async load() {
    return { store: this.store ? structuredClone(this.store) : null, prefs: this.prefs ? { ...this.prefs } : null };
  }
  async saveStore(s: Store) {
    this.store = structuredClone(s);
  }
  async savePrefs(p: Prefs) {
    this.prefs = { ...p };
  }
  async putImage(name: string, data: Blob) {
    this.images.set(name, data);
  }
  async imageUrl(name: string) {
    const b = this.images.get(name);
    return b ? URL.createObjectURL(b) : null;
  }
  async listImages() {
    return [...this.images.keys()];
  }
}

/** IndexedDB: one database per server/account so identities never mix (local = "local"). */
export class IndexedDbStorage implements StorageAdapter {
  readonly label: string;
  private db: Promise<IDBDatabase>;
  private urls = new Map<string, string>();

  constructor(private readonly space = 'local') {
    this.label = `this browser (IndexedDB "noteboard-${space}")`;
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(`noteboard-${space}`, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('images');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async tx<T>(name: 'kv' | 'images', mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      const r = f(t.objectStore(name));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
    });
  }

  async load() {
    const store = ((await this.tx('kv', 'readonly', (s) => s.get('store'))) as Store | undefined) ?? null;
    const prefs = ((await this.tx('kv', 'readonly', (s) => s.get('prefs'))) as Prefs | undefined) ?? null;
    return { store, prefs };
  }
  async saveStore(store: Store) {
    await this.tx('kv', 'readwrite', (s) => s.put(store, 'store'));
  }
  async savePrefs(prefs: Prefs) {
    await this.tx('kv', 'readwrite', (s) => s.put(prefs, 'prefs'));
  }
  async putImage(name: string, data: Blob) {
    await this.tx('images', 'readwrite', (s) => s.put(data, name));
    this.urls.delete(name);
  }
  async imageUrl(name: string) {
    const known = this.urls.get(name);
    if (known) return known;
    const blob = (await this.tx('images', 'readonly', (s) => s.get(name))) as Blob | undefined;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(name, url);
    return url;
  }
  async listImages() {
    return ((await this.tx('images', 'readonly', (s) => s.getAllKeys())) as IDBValidKey[]).map(String);
  }
}
