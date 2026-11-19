/**
 * This device's copy of an account's boards, kept in IndexedDB per server and account:
 *
 * - `base`: the server's boards as last synced (revision `baseRev`), the starting point of merges;
 * - `local`: the boards as they are on this device now (`dirty` when they differ from what the
 *   server has confirmed);
 * - `inflight`: a save that was sent but not confirmed (its operation id tells whether it arrived);
 * - pictures: added on this device and not uploaded yet (`pending`), or downloaded so they can be
 *   shown without a connection.
 *
 * Nothing here is shared between accounts or servers; signing out deletes the account's copy.
 */
import type { Store } from '@noteboard/board-model';
import type { Prefs } from '@noteboard/ui-workspace';

export interface Replica {
  v: 1;
  baseRev: number;
  /** JSON of the server's boards at `baseRev` (null: the account had none yet). */
  base: string | null;
  /** JSON of the boards on this device. */
  local: string | null;
  dirty: boolean;
  inflight: { opId: string; body: string; baseRev: number } | null;
  prefs: Prefs | null;
  prefsDirty: boolean;
  syncedAt: number;
}

export interface StoredAsset {
  blob: Blob;
  pending: boolean;
}

const DB = 'noteboard-replica';
let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbp ??= new Promise((resolve) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('replica');
      r.result.createObjectStore('assets');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
  return dbp;
}

function req<T>(store: 'replica' | 'assets', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((resolve) => {
        if (!d) return resolve(null);
        const tx = d.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve((r.result as T) ?? null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      }),
  );
}

export const emptyReplica = (): Replica => ({ v: 1, baseRev: 0, base: null, local: null, dirty: false, inflight: null, prefs: null, prefsDirty: false, syncedAt: 0 });

export const readReplica = (key: string) => req<Replica>('replica', 'readonly', (s) => s.get(key));
export const writeReplica = (key: string, r: Replica) => req('replica', 'readwrite', (s) => s.put(r, key));

export const readAsset = (key: string, name: string) => req<StoredAsset>('assets', 'readonly', (s) => s.get(`${key}|${name}`));
export const writeAsset = (key: string, name: string, a: StoredAsset) => req('assets', 'readwrite', (s) => s.put(a, `${key}|${name}`));

/** Names of this account's pictures stored here (all, or only those still to upload). */
export async function assetNames(key: string, pendingOnly = false): Promise<string[]> {
  const keys = (await req<IDBValidKey[]>('assets', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(`${key}|`, `${key}|￿`)))) ?? [];
  const names = keys.map((k) => String(k).slice(key.length + 1));
  if (!pendingOnly) return names;
  const out: string[] = [];
  for (const n of names) if ((await readAsset(key, n))?.pending) out.push(n);
  return out;
}

/** Deletes an account's copy and pictures from this device (sign-out, forgetting a server). */
export async function dropReplica(key: string): Promise<void> {
  await req('replica', 'readwrite', (s) => s.delete(key));
  await req('assets', 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${key}|`, `${key}|￿`)));
}

/** Every account copy kept for a server (key prefix "<serverId>|"). */
export async function replicaKeys(prefix: string): Promise<string[]> {
  const keys = (await req<IDBValidKey[]>('replica', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)))) ?? [];
  return keys.map(String);
}

export type { Store };
