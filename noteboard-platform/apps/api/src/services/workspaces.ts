/**
 * Private workspaces. Each account owns one; it is read and written only through its owner's
 * session (every query carries the owner's workspace id). Boards are stored one document each so a
 * save only rewrites the boards that changed, inside a transaction with a revision check.
 */
import crypto from 'node:crypto';
import type { AnyBulkWriteOperation } from 'mongodb';
import type { Board, Store } from '@noteboard/board-model';
import { STORE_VERSION } from '@noteboard/board-model';
import { sha256, uuid } from '../crypto';
import type { AssetDoc, BoardDoc, Database, WorkspaceDoc } from '../db';
import { type BlobStore, sniffImage } from './blobs';
import { checkStore, SAFE_ASSET_NAME } from './store-check';

export class ApiFail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const hashBoard = (b: Board) => sha256(JSON.stringify(b));

export class Workspaces {
  constructor(
    private readonly d: Database,
    private readonly blobs: BlobStore,
  ) {}

  async forUser(userId: string): Promise<WorkspaceDoc> {
    const found = await this.d.c.workspaces.findOne({ ownerId: userId });
    if (found) return found;
    const now = new Date();
    const doc: WorkspaceDoc = {
      _id: uuid(),
      ownerId: userId,
      name: 'Personal',
      rev: 0,
      root: 1,
      next_id: 2,
      version: STORE_VERSION,
      trash: [],
      imports: [],
      prefs: null,
      usage: { boards: 0, cards: 0, arrows: 0, assets: 0, assetBytes: 0 },
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.d.c.workspaces.insertOne(doc);
      return doc;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return (await this.d.c.workspaces.findOne({ ownerId: userId }))!;
      throw e;
    }
  }

  /** The stored boards as one store, or null when nothing has been saved yet. */
  async load(ws: WorkspaceDoc): Promise<Store | null> {
    if (ws.rev === 0) return null;
    const boards: Store['boards'] = {};
    for await (const b of this.d.c.boards.find({ workspaceId: ws._id })) boards[String(b.boardId)] = b.data;
    const store: Store & { imports?: unknown[] } = { boards, root: ws.root, next_id: ws.next_id, trash: ws.trash, version: ws.version };
    if (ws.imports?.length) store.imports = ws.imports;
    return store;
  }

  async save(ws: WorkspaceDoc, expectedRev: number, input: unknown): Promise<{ rev: number; blankedLinks: number; written: number }> {
    const check = checkStore(input);
    if (!check.ok) throw new ApiFail(400, 'invalid_store', 'The boards could not be saved because they are not valid', check.errors.slice(0, 20));
    const store = input as Store & { imports?: unknown[] };
    const existing = new Map<number, string>();
    for await (const b of this.d.c.boards.find({ workspaceId: ws._id }, { projection: { boardId: 1, hash: 1 } })) existing.set(b.boardId, b.hash);
    const now = new Date();
    const ops: AnyBulkWriteOperation<BoardDoc>[] = [];
    const keep = new Set<number>();
    for (const b of Object.values(store.boards)) {
      keep.add(b.id);
      const h = hashBoard(b);
      if (existing.get(b.id) === h) continue;
      const doc: BoardDoc = { _id: `${ws._id}:${b.id}`, workspaceId: ws._id, boardId: b.id, hash: h, data: b, updatedAt: now };
      ops.push({ replaceOne: { filter: { _id: doc._id, workspaceId: ws._id }, replacement: doc, upsert: true } });
    }
    for (const id of existing.keys()) if (!keep.has(id)) ops.push({ deleteOne: { filter: { _id: `${ws._id}:${id}`, workspaceId: ws._id } } });
    const session = this.d.client.startSession();
    let rev = 0;
    try {
      await session.withTransaction(async () => {
        const upd = await this.d.c.workspaces.findOneAndUpdate(
          { _id: ws._id, rev: expectedRev },
          {
            $set: {
              root: store.root,
              next_id: store.next_id,
              version: store.version,
              trash: store.trash,
              imports: store.imports ?? [],
              updatedAt: now,
              'usage.boards': check.counts.boards,
              'usage.cards': check.counts.cards,
              'usage.arrows': check.counts.arrows,
            },
            $inc: { rev: 1 },
          },
          { session, returnDocument: 'after' },
        );
        if (!upd) throw new ApiFail(409, 'conflict', 'These boards were changed in another window or device. Reload to see the latest version.');
        rev = upd.rev;
        if (ops.length) await this.d.c.boards.bulkWrite(ops, { session, ordered: true });
      });
    } finally {
      await session.endSession();
    }
    return { rev, blankedLinks: check.blankedLinks, written: ops.length };
  }

  async savePrefs(ws: WorkspaceDoc, prefs: unknown): Promise<void> {
    if (!prefs || typeof prefs !== 'object' || JSON.stringify(prefs).length > 8000) throw new ApiFail(400, 'invalid_prefs', 'Preferences are not valid');
    await this.d.c.workspaces.updateOne({ _id: ws._id }, { $set: { prefs: prefs as Record<string, unknown> } });
  }

  // ---------- pictures ----------

  async putAsset(ws: WorkspaceDoc, name: string, data: Buffer, quotaBytes: number): Promise<AssetDoc> {
    if (!SAFE_ASSET_NAME.test(name)) throw new ApiFail(400, 'invalid_name', 'That file name is not allowed');
    const mime = sniffImage(data);
    if (!mime) throw new ApiFail(415, 'unsupported_type', 'Only PNG, JPEG, GIF, WebP, BMP and ICO pictures can be uploaded');
    const prev = await this.d.c.assets.findOne({ workspaceId: ws._id, name });
    if (quotaBytes > 0) {
      const used = ws.usage.assetBytes - (prev?.size ?? 0);
      if (used + data.length > quotaBytes)
        throw new ApiFail(413, 'quota_exceeded', `This upload would go over your storage limit (${Math.round(quotaBytes / 1048576)} MB)`);
    }
    const key = `${ws._id}/${crypto.randomBytes(12).toString('hex')}`;
    await this.blobs.put(key, data);
    const doc: AssetDoc = { _id: prev?._id ?? uuid(), workspaceId: ws._id, name, key, size: data.length, mime, sha256: sha256(data), createdAt: new Date() };
    await this.d.c.assets.replaceOne({ workspaceId: ws._id, name }, doc, { upsert: true });
    if (prev) await this.blobs.delete(prev.key).catch(() => undefined);
    await this.d.c.workspaces.updateOne({ _id: ws._id }, { $inc: { 'usage.assetBytes': data.length - (prev?.size ?? 0), 'usage.assets': prev ? 0 : 1 } });
    return doc;
  }

  async getAsset(ws: WorkspaceDoc, name: string) {
    const a = await this.d.c.assets.findOne({ workspaceId: ws._id, name });
    if (!a) return null;
    const stream = await this.blobs.get(a.key);
    return stream ? { asset: a, stream } : null;
  }

  async listAssets(ws: WorkspaceDoc): Promise<string[]> {
    return (await this.d.c.assets.find({ workspaceId: ws._id }, { projection: { name: 1 } }).toArray()).map((a) => a.name);
  }
}
