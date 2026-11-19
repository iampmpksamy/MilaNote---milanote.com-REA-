/**
 * Unsent saves, kept on this device until the server confirms them, so a closed app, a lost
 * connection or a crash doesn't lose the last changes. One draft per server and account.
 *
 * This is draft preservation for online use, not offline editing: a draft is sent again when the
 * server is reachable, and only if nobody changed the boards on the server in the meantime.
 */
export interface Draft {
  /** Revision the change was made on. */
  baseRev: number;
  /** Operation id: a retried save with the same id is acknowledged, not applied twice. */
  opId: string;
  body: string;
  /** Edits made after `body` while it was still waiting to be confirmed. */
  next?: string;
  at: number;
}

const DB = 'noteboard-drafts';
const STORE = 'drafts';

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

export const getDraft = (key: string) => tx<Draft>('readonly', (s) => s.get(key) as IDBRequest<Draft>);
export const putDraft = (key: string, d: Draft) => tx('readwrite', (s) => s.put(d, key));
export const dropDraft = (key: string) => tx('readwrite', (s) => s.delete(key));

export function newOpId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
