/** The signed-in user's own boards, preferences, pictures and export. Never anyone else's. */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CTX, type Ctx } from '../ctx';
import { ApiFail, type NbRequest, needUser, notInMaintenance } from '../http';
import type { ByteRange } from '../services/blobs';
import { TarWriter } from '../services/tar';

/**
 * Reads an HTTP Range header for a file of `size` bytes: the one range asked for, 'unsatisfiable'
 * (→ 416), or null to send the whole file (no header, several ranges, or a header that isn't
 * understood: those are ignored, as HTTP allows).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // The last N bytes.
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (m[2] !== '' && Number(m[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

@Controller()
export class WorkspaceRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  @Get('workspace')
  async get(@Req() req: NbRequest) {
    const { user } = needUser(req);
    const ws = await this.ctx.workspaces.forUser(user._id);
    return { rev: ws.rev, store: await this.ctx.workspaces.load(ws), prefs: ws.prefs, updatedAt: ws.updatedAt, recentOps: ws.recentOps ?? [] };
  }

  @Put('workspace')
  async put(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user } = needUser(req);
    await notInMaintenance(this.ctx, user);
    const ws = await this.ctx.workspaces.forUser(user._id);
    const rev = Number(b['rev']);
    if (!Number.isInteger(rev) || rev < 0) throw new ApiFail(400, 'bad_rev', 'rev is required');
    const opId = typeof b['opId'] === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b['opId']) ? b['opId'] : undefined;
    return this.ctx.workspaces.save(ws, rev, b['store'], opId);
  }

  @Put('workspace/prefs')
  async prefs(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user } = needUser(req);
    const ws = await this.ctx.workspaces.forUser(user._id);
    await this.ctx.workspaces.savePrefs(ws, b['prefs']);
    return { ok: true };
  }

  /** Remembers that a desktop or browser file was brought in (shown in the account and backups). */
  @Post('workspace/imports')
  @HttpCode(201)
  async imported(@Req() req: NbRequest, @Body() b: Record<string, unknown>) {
    const { user } = needUser(req);
    const report = b['report'] && typeof b['report'] === 'object' ? (b['report'] as Record<string, unknown>) : {};
    const summary = {
      source: String(b['source'] ?? 'desktop').slice(0, 40),
      fingerprint: String(report['fingerprint'] ?? '').slice(0, 100),
      boards: Number(report['boards'] ?? 0),
      cards: Number(report['cards'] ?? 0),
      images: Array.isArray(report['images']) ? report['images'].length : 0,
    };
    await this.ctx.audit('workspace.import', { actor: user, ip: req.nb.ip, details: summary });
    return { ok: true };
  }

  @Get('assets')
  async list(@Req() req: NbRequest) {
    const { user } = needUser(req);
    return { names: await this.ctx.workspaces.listAssets(await this.ctx.workspaces.forUser(user._id)) };
  }

  @Put('assets/:name')
  async upload(@Req() req: NbRequest, @Param('name') name: string) {
    const { user } = needUser(req);
    await notInMaintenance(this.ctx, user);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      throw new ApiFail(400, 'empty', 'Send the file as the request body with an image, audio or video content type');
    const ws = await this.ctx.workspaces.forUser(user._id);
    const s = await this.ctx.settings.get();
    const quota = user.quotaBytes ?? s.defaultQuotaBytes;
    const limits = { imageMb: this.ctx.cfg.maxUploadMb, mediaMb: this.ctx.cfg.maxMediaMb };
    const a = await this.ctx.workspaces.putAsset(ws, name, req.body, quota, String(req.headers['content-type'] ?? ''), limits);
    return { name: a.name, size: a.size, mime: a.mime };
  }

  /** A stored file. Audio and video players ask for parts of it (Range) to seek. */
  @Get('assets/:name')
  async download(@Req() req: NbRequest, @Res() res: Response, @Param('name') name: string) {
    const { user } = needUser(req);
    const ws = await this.ctx.workspaces.forUser(user._id);
    const asset = await this.ctx.workspaces.findAsset(ws, name);
    if (!asset) throw new ApiFail(404, 'not_found', 'No such file');
    // A Range only applies to the version the player already has (If-Range with an older ETag
    // means "send it all").
    const ifRange = req.headers['if-range'];
    const range = ifRange && ifRange !== `"${asset.sha256}"` ? null : parseRange(req.headers.range, asset.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', `"${asset.sha256}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    if (range === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${asset.size}`);
      res.end();
      return;
    }
    const found = await this.ctx.workspaces.getAsset(ws, name, range ?? undefined);
    if (!found) throw new ApiFail(404, 'not_found', 'No such file');
    res.setHeader('Content-Type', asset.mime);
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.setHeader('Content-Length', String(asset.size));
    }
    if (req.method === 'HEAD') {
      found.stream.destroy();
      res.end();
      return;
    }
    found.stream.on('error', () => res.destroy());
    found.stream.pipe(res);
  }

  /** Everything this account holds, as boards.json (desktop format) + prefs.json + images/. */
  @Get('export')
  async export(@Req() req: NbRequest, @Res() res: Response) {
    const { user } = needUser(req);
    const ws = await this.ctx.workspaces.forUser(user._id);
    const store = await this.ctx.workspaces.load(ws);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="noteboard-export-${new Date().toISOString().slice(0, 10)}.tar.gz"`);
    const tar = new TarWriter(res);
    await tar.addBuffer('noteboard-export/boards.json', Buffer.from(JSON.stringify(store ?? {}, null, 1)));
    await tar.addBuffer('noteboard-export/prefs.json', Buffer.from(JSON.stringify(ws.prefs ?? {}, null, 1)));
    for (const a of await this.ctx.d.c.assets.find({ workspaceId: ws._id }).toArray()) {
      const stream = await this.ctx.blobs.get(a.key);
      if (stream) await tar.addStream(`noteboard-export/images/${a.name.replace(/[/\\]/g, '_')}`, a.size, stream, a.createdAt);
    }
    await tar.finish();
    await this.ctx.audit('workspace.export', { actor: user, ip: req.nb.ip });
  }
}
