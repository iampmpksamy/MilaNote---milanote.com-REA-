/** The signed-in user's own boards, preferences, pictures and export. Never anyone else's. */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CTX, type Ctx } from '../ctx';
import { ApiFail, type NbRequest, needUser, notInMaintenance } from '../http';
import { TarWriter } from '../services/tar';

@Controller()
export class WorkspaceRoutes {
  constructor(@Inject(CTX) private readonly ctx: Ctx) {}

  @Get('workspace')
  async get(@Req() req: NbRequest) {
    const { user } = needUser(req);
    const ws = await this.ctx.workspaces.forUser(user._id);
    return { rev: ws.rev, store: await this.ctx.workspaces.load(ws), prefs: ws.prefs, updatedAt: ws.updatedAt };
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
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ApiFail(400, 'empty', 'Send the picture as the request body with an image content type');
    const ws = await this.ctx.workspaces.forUser(user._id);
    const s = await this.ctx.settings.get();
    const quota = user.quotaBytes ?? s.defaultQuotaBytes;
    const a = await this.ctx.workspaces.putAsset(ws, name, req.body, quota);
    return { name: a.name, size: a.size, mime: a.mime };
  }

  @Get('assets/:name')
  async download(@Req() req: NbRequest, @Res() res: Response, @Param('name') name: string) {
    const { user } = needUser(req);
    const found = await this.ctx.workspaces.getAsset(await this.ctx.workspaces.forUser(user._id), name);
    if (!found) throw new ApiFail(404, 'not_found', 'No such picture');
    res.setHeader('Content-Type', found.asset.mime);
    res.setHeader('Content-Length', String(found.asset.size));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', `"${found.asset.sha256}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline');
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
