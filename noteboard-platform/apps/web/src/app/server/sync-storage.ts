/**
 * Boards saved to the signed-in account, with offline editing.
 *
 * Every change is first written to this device (native/replica.ts), then sent to the server.
 *
 * - Online: a save carries the revision it was based on and an operation id. If another device
 *   saved in between (409), the server's boards are fetched and merged with this device's
 *   (three-way merge from the last synced version, @noteboard/board-model mergeStores), the
 *   result is saved, and the open boards are updated to it.
 * - Offline: changes stay on this device, saving is retried with growing pauses and right away
 *   when the connection comes back; the native apps also open the last copy without a connection.
 * - A save whose answer was lost: the server lists its recent operation ids, so the merge starts
 *   from what actually arrived (no duplicated cards).
 * - Pictures added offline are kept here and uploaded before the boards that use them.
 * - Other devices' changes are fetched when the app comes back to the foreground, when the
 *   connection returns, and every minute while it is visible.
 */
import { signal } from '@angular/core';
import { emptyStore, type MergeConflict, mergeStores, renumber, type Store } from '@noteboard/board-model';
import type { Prefs, StorageAdapter } from '@noteboard/ui-workspace';
import { conn } from '../native/connection';
import { type Draft, dropDraft, getDraft, newOpId } from '../native/drafts';
import { platform } from '../native/platform';
import { assetNames, dropReplica, emptyReplica, readAsset, readReplica, type Replica, writeAsset, writeReplica } from '../native/replica';
import { api, apiBlob, ApiError } from './api';

interface ServerWorkspace {
  rev: number;
  store: Store | null;
  prefs: Prefs | null;
  recentOps?: string[];
}

type SyncState = 'saved' | 'saving' | 'offline' | 'error';
interface Sent {
  opId: string;
  body: string;
}
type ReplicaWithSent = Replica & { sent?: Sent[] };

const isNetwork = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);
const WAITS = [2, 5, 10, 20, 30, 60];

function deviceLabel(): string {
  const p = platform();
  const name = p === 'android' ? 'Android' : p === 'ios' ? (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : p === 'windows' ? 'Windows app' : 'browser';
  return `${name}, ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export class ServerStorage implements StorageAdapter {
  readonly label: string;
  readonly remote = true;
  private rep: ReplicaWithSent = emptyReplica();
  /** JSON of the boards the workspace has (to rebase its edits when the copy here moved on). */
  private handed: string | null = null;
  private offerTo: ((s: Store) => boolean) | null = null;
  /** Ids renumbered by merges since the workspace last took the boards (its copy still has the old ids). */
  private renumberedSinceHanded = new Map<number, number>();
  private offerTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private attempts = 0;
  private started = false;
  private readonly blobUrls = new Map<string, string>();

  readonly state = signal<SyncState>('saved');
  readonly dirty = signal(false);
  readonly offline = signal(false);
  readonly loadError = signal('');
  readonly lastError = signal('');
  /** What the last merge did, for a short notice ("2 conflicting copies are in Unsorted"). */
  readonly mergeNote = signal('');
  /** A change kept by the previous version of the app (drafts) that could not be applied. */
  readonly strandedDraft = signal<Draft | null>(null);
  /** Kept for the boards page; merges replace refusals, so this stays false. */
  readonly conflict = signal(false);

  constructor(
    appName: string,
    private readonly key = 'default',
  ) {
    this.label = `your ${appName} server`;
  }

  // ---------- StorageAdapter ----------

  async load(): Promise<{ store: Store | null; prefs: Prefs | null }> {
    const saved = await readReplica(this.key);
    if (saved) this.rep = saved as ReplicaWithSent;
    this.dirty.set(this.rep.dirty);
    let server: ServerWorkspace;
    try {
      server = await api<ServerWorkspace>('GET', '/workspace');
    } catch (e) {
      if (isNetwork(e) && this.rep.local) {
        this.goOffline();
        this.handed = this.rep.local;
        this.startBackground();
        return { store: JSON.parse(this.rep.local) as Store, prefs: this.rep.prefs };
      }
      this.loadError.set(e instanceof ApiError ? e.message : 'Your boards could not be loaded.');
      throw e;
    }
    this.offline.set(false);
    const old = await getDraft(this.key);
    if (old) this.strandedDraft.set(old);
    if (this.rep.dirty && this.rep.local) await this.reconcile(server);
    else await this.adopt(server);
    if (this.rep.prefsDirty && this.rep.prefs) this.kick();
    this.handed = this.rep.local;
    this.startBackground();
    return { store: this.rep.local ? (JSON.parse(this.rep.local) as Store) : null, prefs: this.rep.prefs ?? server.prefs };
  }

  async saveStore(store: Store): Promise<void> {
    const incoming = JSON.stringify(store);
    if (this.handed !== null && this.rep.local !== null && this.rep.local !== this.handed) {
      // The copy here moved on (merged with another device) after the workspace got its version:
      // apply the workspace's edits on top of it instead of overwriting the merge.
      const handed = JSON.parse(this.handed) as Store;
      const mine = structuredClone(store);
      renumber(handed, this.renumberedSinceHanded);
      renumber(mine, this.renumberedSinceHanded);
      const m = mergeStores(handed, mine, JSON.parse(this.rep.local) as Store, { label: deviceLabel() });
      this.addRenumbered(m.renumbered);
      this.rep.local = JSON.stringify(m.store);
      this.handed = incoming;
      this.offerSoon();
    } else {
      this.rep.local = incoming;
      this.handed = incoming;
    }
    this.rep.dirty = true;
    this.dirty.set(true);
    await this.persist();
    this.kick();
  }

  async savePrefs(prefs: Prefs): Promise<void> {
    this.rep.prefs = prefs;
    this.rep.prefsDirty = true;
    await this.persist();
    this.kick();
  }

  async putImage(name: string, data: Blob): Promise<void> {
    // Kept here first; uploaded by the sync loop before the boards that use it.
    await writeAsset(this.key, name, { blob: data, pending: true });
    const old = this.blobUrls.get(name);
    if (old) URL.revokeObjectURL(old);
    this.blobUrls.delete(name);
    this.kick();
  }

  async imageUrl(name: string): Promise<string | null> {
    const have = this.blobUrls.get(name);
    if (have) return have;
    const local = await readAsset(this.key, name);
    if (local) return this.remember(name, local.blob);
    if (!conn.native) return `/api/v1/assets/${encodeURIComponent(name)}`;
    // Apps: fetched with the sign-in token and kept for offline use.
    try {
      const blob = await apiBlob(`/assets/${encodeURIComponent(name)}`);
      await writeAsset(this.key, name, { blob, pending: false });
      return this.remember(name, blob);
    } catch {
      return null;
    }
  }

  async listImages(): Promise<string[]> {
    const local = await assetNames(this.key);
    try {
      const server = (await api<{ names: string[] }>('GET', '/assets')).names;
      return [...new Set([...server, ...local])];
    } catch {
      return local;
    }
  }

  /** Reads from the server for the cards (maps); same sign-in as everything else here. */
  apiGet(path: string, as: 'json' | 'blob'): Promise<unknown> {
    return as === 'blob' ? apiBlob(path) : api('GET', path);
  }

  onExternalChange(handler: (store: Store) => boolean): void {
    this.offerTo = handler;
  }

  syncStatus(): SyncState {
    const s = this.state();
    if (s === 'error') return 'error';
    if (!this.dirty()) return 'saved';
    return this.offline() ? 'offline' : 'saving';
  }

  // ---------- for the boards page ----------

  /** Unsent changes or pictures on this device (sign-out asks first). */
  async hasUnsynced(): Promise<boolean> {
    return this.rep.dirty || this.rep.prefsDirty || (await assetNames(this.key, true)).length > 0;
  }

  /** Deletes this account's copy on this device (after signing out). */
  async forget(): Promise<void> {
    this.stop();
    await dropReplica(this.key);
  }

  retryNow(): void {
    this.attempts = 0;
    this.kick();
  }

  async discardDraft(): Promise<void> {
    await dropDraft(this.key);
    this.strandedDraft.set(null);
  }

  // ---------- sync loop ----------

  private kick(): void {
    if (this.wake) this.wake();
    if (!this.running)
      this.running = this.run().finally(() => {
        this.running = null;
      });
  }

  private async run(): Promise<void> {
    for (;;) {
      try {
        const progress = await this.step();
        this.attempts = 0;
        this.offline.set(false);
        this.lastError.set('');
        if (!progress) {
          this.state.set('saved');
          return;
        }
      } catch (e) {
        if (isNetwork(e)) {
          this.goOffline();
          await this.pause();
          continue;
        }
        this.state.set('error');
        this.lastError.set(e instanceof ApiError ? e.message : 'Saving failed.');
        return;
      }
    }
  }

  /** One round of work; false when there is nothing left to send. */
  private async step(): Promise<boolean> {
    // 1. Pictures first, so the server never has a card without its picture.
    for (const name of await assetNames(this.key, true)) {
      const a = await readAsset(this.key, name);
      if (!a) continue;
      this.state.set('saving');
      try {
        await api('PUT', `/assets/${encodeURIComponent(name)}`, undefined, { type: a.blob.type, data: a.blob });
      } catch (e) {
        // Refused for good (not a picture, too big, over quota): keep it here, stop retrying it.
        if (!(e instanceof ApiError) || isNetwork(e) || e.status === 401) throw e;
        this.mergeNote.set(`A picture could not be uploaded: ${e.message}`);
      }
      await writeAsset(this.key, name, { blob: a.blob, pending: false });
    }
    // 2. Preferences.
    if (this.rep.prefsDirty && this.rep.prefs) {
      await api('PUT', '/workspace/prefs', { prefs: this.rep.prefs });
      this.rep.prefsDirty = false;
      await this.persist();
    }
    // 3. Boards.
    if (!this.rep.dirty || this.rep.local === null) return false;
    this.state.set('saving');
    const body = this.rep.local;
    const sent: Sent = { opId: newOpId(), body };
    this.rep.sent = [...(this.rep.sent ?? []), sent].slice(-5);
    await this.persist();
    try {
      const r = await api<{ rev: number }>('PUT', '/workspace', { rev: this.rep.baseRev, store: JSON.parse(body), opId: sent.opId });
      this.rep.base = body;
      this.rep.baseRev = r.rev;
      this.rep.sent = [];
      this.rep.dirty = this.rep.local !== body;
      this.rep.syncedAt = Date.now();
      this.dirty.set(this.rep.dirty);
      await this.persist();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
      await this.reconcile(await api<ServerWorkspace>('GET', '/workspace'));
    }
    return true;
  }

  /** Merges this device's boards with the server's and saves the result (retries if beaten again). */
  private async reconcile(server: ServerWorkspace): Promise<void> {
    for (let round = 0; round < 5; round++) {
      // Which of our versions does the server already have? (a save whose answer was lost)
      let baseJson = this.rep.base;
      const recent = new Set(server.recentOps ?? []);
      for (const s of [...(this.rep.sent ?? [])].reverse())
        if (recent.has(s.opId)) {
          baseJson = s.body;
          break;
        }
      const atStart = this.rep.local;
      if (atStart === null) return this.adopt(server);
      if (!server.store) {
        // Nothing on the server (yet): this device's boards are the boards.
        const r = await this.put(atStart, server.rev);
        if (r === null) {
          server = await api<ServerWorkspace>('GET', '/workspace');
          continue;
        }
        return this.confirmed(atStart, r, null);
      }
      const base = baseJson ? (JSON.parse(baseJson) as Store) : emptyStore();
      const m = mergeStores(base, JSON.parse(atStart) as Store, server.store, { label: deviceLabel() });
      // (When nothing of this device's is left to send, take the server's exact text so nothing looks unsaved.)
      const merged = m.changed ? JSON.stringify(m.store) : JSON.stringify(server.store);
      // This device takes the merge first: if the answer to the save below is lost, the device
      // already holds what the server may have, so the next attempt can't undo the other side's work.
      await this.takeLocally(merged, atStart, m.renumbered);
      if (!m.changed) return this.confirmed(merged, server.rev, m.conflicts);
      const rev = await this.put(merged, server.rev);
      if (rev === null) {
        server = await api<ServerWorkspace>('GET', '/workspace');
        continue;
      }
      return this.confirmed(merged, rev, m.conflicts);
    }
    throw new ApiError(409, 'conflict', 'Your boards keep changing on another device; trying again shortly.');
  }

  /** Saves `body` on top of server revision `rev`; null when another save got there first. */
  private async put(body: string, rev: number): Promise<number | null> {
    const sent: Sent = { opId: newOpId(), body };
    this.rep.sent = [...(this.rep.sent ?? []), sent].slice(-5);
    await this.persist();
    try {
      return (await api<{ rev: number }>('PUT', '/workspace', { rev, store: JSON.parse(body), opId: sent.opId })).rev;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return null;
      throw e;
    }
  }

  /** This device's boards become `merged`; edits made here since `atStart` are kept on top (translated to new ids). */
  private async takeLocally(merged: string, atStart: string, renumbered: Map<number, number>): Promise<void> {
    this.addRenumbered(renumbered);
    if (this.rep.local !== atStart && this.rep.local !== null) {
      const before = JSON.parse(atStart) as Store;
      const now = JSON.parse(this.rep.local) as Store;
      renumber(before, renumbered);
      renumber(now, renumbered);
      this.rep.local = JSON.stringify(mergeStores(before, now, JSON.parse(merged) as Store, { label: deviceLabel() }).store);
    } else this.rep.local = merged;
    this.rep.dirty = true;
    this.dirty.set(true);
    await this.persist();
    this.offer();
  }

  /** The server now has `serverJson` at `rev`. */
  private async confirmed(serverJson: string, rev: number, conflicts: MergeConflict[] | null): Promise<void> {
    this.rep.base = serverJson;
    this.rep.baseRev = rev;
    this.rep.sent = [];
    this.rep.syncedAt = Date.now();
    this.rep.dirty = this.rep.local !== serverJson;
    this.dirty.set(this.rep.dirty);
    await this.persist();
    if (conflicts) this.describe(conflicts);
    this.offer();
  }

  private async adopt(server: ServerWorkspace): Promise<void> {
    const json = server.store ? JSON.stringify(server.store) : null;
    this.rep = { ...this.rep, base: json, local: json, baseRev: server.rev, dirty: false, sent: [], syncedAt: Date.now() };
    if (!this.rep.prefsDirty) this.rep.prefs = server.prefs;
    this.dirty.set(false);
    await this.persist();
  }

  private describe(conflicts: MergeConflict[]): void {
    const copies = conflicts.filter((c) => c.kind === 'content').length;
    const kept = conflicts.filter((c) => c.kind === 'edited-deleted' || c.kind === 'deleted-edited').length;
    const parts = ['Changes from another device were combined with yours.'];
    if (copies) parts.push(`${copies} card${copies > 1 ? 's were' : ' was'} changed in both places: your version is in Unsorted as a "Conflicting copy".`);
    if (kept) parts.push(`${kept} item${kept > 1 ? 's' : ''} deleted in one place but changed in the other ${kept > 1 ? 'were' : 'was'} kept.`);
    if (copies || kept) this.mergeNote.set(parts.join(' '));
  }

  /** Gives the workspace the boards as they are here now (it may refuse while editing). */
  private offer(): void {
    if (!this.offerTo || this.rep.local === null || this.rep.local === this.handed) return;
    if (this.offerTo(JSON.parse(this.rep.local) as Store)) {
      this.handed = this.rep.local;
      this.renumberedSinceHanded.clear();
    } else this.offerSoon();
  }

  private offerSoon(): void {
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(() => {
      this.offerTimer = null;
      this.offer();
    }, 1500);
  }

  /** Fetches other devices' changes when nothing of ours is waiting. */
  private async pull(): Promise<void> {
    if (this.running || !this.started) return;
    if (this.rep.dirty) return this.kick();
    try {
      const server = await api<ServerWorkspace>('GET', '/workspace');
      this.offline.set(false);
      if (this.rep.dirty) return this.kick(); // edited while we were asking
      if (server.rev !== this.rep.baseRev) {
        await this.adopt(server);
        this.offer();
      }
    } catch (e) {
      if (isNetwork(e)) this.goOffline();
    }
  }

  private readonly onOnline = () => {
    this.attempts = 0;
    if (this.rep.dirty) this.kick();
    else void this.pull();
  };
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.onOnline();
  };
  private pullTimer: ReturnType<typeof setInterval> | null = null;

  private startBackground(): void {
    if (this.started) return;
    this.started = true;
    addEventListener('online', this.onOnline);
    addEventListener('nb-resume', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.pullTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.pull();
    }, 60_000);
    if (this.rep.dirty || this.rep.prefsDirty) this.kick();
    else void assetNames(this.key, true).then((p) => p.length && this.kick());
  }

  private stop(): void {
    this.started = false;
    removeEventListener('online', this.onOnline);
    removeEventListener('nb-resume', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.pullTimer) clearInterval(this.pullTimer);
    if (this.offerTimer) clearTimeout(this.offerTimer);
  }

  private goOffline(): void {
    this.offline.set(true);
    this.state.set(this.rep.dirty ? 'offline' : 'saved');
  }

  /** Waits 2 s, 5 s, 10 s … 60 s; new edits, "Try now" and the connection coming back cut it short. */
  private pause(): Promise<void> {
    const s = WAITS[Math.min(this.attempts++, WAITS.length - 1)];
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
      const t = setTimeout(done, s * 1000);
      this.wake = done;
    });
  }

  /** Adds a merge's renumbering, chained onto earlier ones (a→b then b→c gives a→c). */
  private addRenumbered(map: Map<number, number>): void {
    for (const [a, b] of this.renumberedSinceHanded) if (map.has(b)) this.renumberedSinceHanded.set(a, map.get(b)!);
    for (const [a, b] of map) if (!this.renumberedSinceHanded.has(a)) this.renumberedSinceHanded.set(a, b);
  }

  private remember(name: string, blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(name, url);
    return url;
  }

  private persist(): Promise<unknown> {
    return writeReplica(this.key, this.rep);
  }
}
