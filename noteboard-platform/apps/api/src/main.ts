/** noteboard-api: the HTTP API behind the gateway (internal port 3000, never published). */
import 'reflect-metadata';
import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type NextFunction, raw, type Request, type Response } from 'express';
import { maxBodyMb } from './config';
import { CTX, type Ctx } from './ctx';
import { migrate, SCHEMA_VERSION } from './db';
import { ErrorFilter, type NbRequest, requestState } from './http';
import { AdminRoutes } from './routes/admin';
import { AuthRoutes, MeRoutes } from './routes/auth';
import { GeoRoutes } from './routes/geo';
import { NativeRoutes } from './routes/native';
import { discovery, PublicRoutes } from './routes/public';
import { WorkspaceRoutes } from './routes/workspace';
import { connectAll } from './runtime';

@Module({})
class AppModule {
  static forRoot(ctx: Ctx): DynamicModule {
    return {
      module: AppModule,
      controllers: [PublicRoutes, AuthRoutes, MeRoutes, NativeRoutes, WorkspaceRoutes, AdminRoutes, GeoRoutes],
      providers: [{ provide: CTX, useValue: ctx }],
    };
  }
}

export async function start(): Promise<{ ctx: Ctx; close: () => Promise<void> }> {
  const ctx = await connectAll('api', { bootstrap: true });
  const { cfg, log } = ctx;
  log(`Noteboard ${cfg.version} starting (data ${cfg.dataDir}, storage ${ctx.blobs.driver})`);
  const schema = await migrate(ctx.d, log, async () => {
    await ctx.backups.create('pre-migration', 'system');
  });
  if (schema > SCHEMA_VERSION) {
    log(`refusing to start: the database uses schema ${schema} but this version only knows ${SCHEMA_VERSION}. Use the newer image, or restore a backup made by this version.`);
    process.exit(3);
  }
  await ctx.accounts.ensureNativeIndexes();
  await ctx.settings.seed();
  if (await ctx.setupRequired()) {
    const t = ctx.setupToken();
    const s = await ctx.settings.get();
    log('------------------------------------------------------------------');
    log('First-run setup is open. Open the app and enter this setup token:');
    log(`    ${t.token}`);
    log(`It expires ${t.expiresAt.toISOString()}. ${s.publicUrl ? `Address: ${s.publicUrl}/setup` : 'Open /setup on the app address.'}`);
    log('------------------------------------------------------------------');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(ctx), { bodyParser: false, logger: ['error', 'warn'] });
  app.set('trust proxy', cfg.trustedProxies);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '32mb' });
  // Pictures (and branding) everywhere, up to MAX_UPLOAD_MB, as before.
  app.useBodyParser('raw', { type: ['image/*', 'application/octet-stream'], limit: `${cfg.maxUploadMb}mb` });
  app.use('/api', requestState(ctx));
  // Audio and video (up to MAX_MEDIA_MB) only for file uploads, and only once the sender is known
  // to be signed in, so nobody can make the server hold large bodies in memory without an account.
  const mediaBody = raw({ type: ['audio/*', 'video/*'], limit: `${maxBodyMb(cfg)}mb` });
  app.use('/api/v1/assets', (req: Request, res: Response, next: NextFunction) => ((req as NbRequest).nb?.user ? mediaBody(req, res, next) : next()));
  app.getHttpAdapter()
    .getInstance()
    .get('/.well-known/noteboard.json', async (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await discovery(ctx));
    });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ErrorFilter(log));
  app.enableShutdownHooks();
  await app.listen(cfg.port, '0.0.0.0');
  log(`listening on :${cfg.port}`);
  const close = async () => {
    await app.close();
    await ctx.kv.close();
    await ctx.d.close();
  };
  return { ctx, close };
}

if (require.main === module) {
  start().catch((e) => {
    console.error(`[api] could not start: ${(e as Error).stack ?? e}`);
    process.exit(1);
  });
}
