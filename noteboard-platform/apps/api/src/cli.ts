/**
 * Local administration from the server's own console, for when the web page can't help:
 *
 *   docker exec noteboard-api node cli.js status
 *   docker exec noteboard-api node cli.js setup-token [--new]
 *   docker exec noteboard-api node cli.js recover-admin --email you@example.com [--disable-mfa]
 *   docker exec noteboard-api node cli.js backup
 *   docker exec noteboard-api node cli.js restore /data/backups/<file>.tar.gz --confirm [--replace]
 *
 * Only someone with shell access to the Docker host can run these.
 */
import { SCHEMA_VERSION, schemaVersion } from './db';
import { connectAll } from './runtime';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const cmd = args[0];
  if (!cmd || cmd === 'help' || flag('--help')) {
    console.log(
      'commands: status | setup-token [--new] | recover-admin --email <address> [--disable-mfa] | backup | restore <file> --confirm [--replace]',
    );
    return;
  }
  const ctx = await connectAll('cli', { bootstrap: false });
  try {
    switch (cmd) {
      case 'status': {
        const s = await ctx.settings.get().catch(() => null);
        console.log(
          JSON.stringify(
            {
              version: ctx.cfg.version,
              schema: await schemaVersion(ctx.d),
              schemaExpected: SCHEMA_VERSION,
              setupCompleted: !!s?.setupCompletedAt,
              users: await ctx.d.c.users.countDocuments(),
              publicUrl: s?.publicUrl || null,
              registration: s?.registrationMode,
            },
            null,
            2,
          ),
        );
        break;
      }
      case 'setup-token': {
        if (!(await ctx.setupRequired())) throw new Error('Setup is already complete. Use recover-admin if you lost access.');
        const t = ctx.setupToken(flag('--new'));
        console.log(`Setup token: ${t.token}\nExpires: ${t.expiresAt.toISOString()}`);
        break;
      }
      case 'recover-admin': {
        const email = opt('--email');
        if (!email) throw new Error('Give the account: --email you@example.com');
        const u = await ctx.accounts.findByEmail(email);
        if (!u) throw new Error(`No account with the address ${email}`);
        await ctx.d.c.users.updateOne({ _id: u._id }, { $set: { status: 'active', lockedUntil: null, failedLogins: 0 } });
        if (flag('--disable-mfa')) await ctx.accounts.mfaDisable(u._id);
        await ctx.accounts.revokeAll(u._id);
        const { raw, doc } = await ctx.accounts.issue('reset', { userId: u._id, email: u.email, hours: 2, createdBy: null, note: 'console recovery' });
        const base = (await ctx.settings.get()).publicUrl || '<your app address>';
        await ctx.audit('user.console_recovery', { target: u.email, details: { disableMfa: flag('--disable-mfa') } });
        console.log(`Password link for ${u.email} (${u.role}), valid until ${doc.expiresAt.toISOString()}, single use:\n${base}/reset/${raw}`);
        if (flag('--disable-mfa')) console.log('Two-step sign-in was turned off for this account; turn it on again after signing in.');
        break;
      }
      case 'backup': {
        const b = await ctx.backups.create('manual', 'cli');
        console.log(`Backup written: ${ctx.cfg.dirs.backups}/${b._id} (${b.size} bytes, sha256 ${b.sha256})`);
        break;
      }
      case 'restore': {
        const file = args[1];
        if (!file || !flag('--confirm'))
          throw new Error('Restoring replaces data. Run: restore <file> --confirm   (add --replace to overwrite an instance that already has accounts)');
        const r = await ctx.backups.restore(file, { replace: flag('--replace') });
        await ctx.audit('backup.restored', { details: { file, ...r } });
        console.log(`Restored ${JSON.stringify(r.counts)} and ${r.files} file(s). Restart the app now: docker restart noteboard-api noteboard-worker`);
        break;
      }
      default:
        throw new Error(`Unknown command ${cmd}. Try: help`);
    }
  } finally {
    await ctx.kv.close();
    await ctx.d.close();
  }
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
