/** Platform settings: seeded from the environment on first start, then edited in /admin. */
import type { Config } from '../config';
import { checkPublicUrl, REGISTRATION_MODES } from '../config';
import { decrypt, encrypt } from '../crypto';
import type { Database, SettingsDoc } from '../db';

export class Settings {
  private cache: { at: number; doc: SettingsDoc } | null = null;
  constructor(
    private readonly d: Database,
    private readonly cfg: Config,
    private readonly key: string,
  ) {}

  async seed(): Promise<void> {
    const doc: SettingsDoc = {
      _id: 'platform',
      appName: this.cfg.appName,
      publicUrl: this.cfg.publicUrl,
      registrationMode: this.cfg.registrationMode,
      smtp: {
        enabled: this.cfg.smtp.enabled,
        host: this.cfg.smtp.host,
        port: this.cfg.smtp.port,
        secure: this.cfg.smtp.secure,
        user: this.cfg.smtp.user,
        passwordEnc: this.cfg.smtp.password ? encrypt(this.cfg.smtp.password, this.key) : null,
        from: this.cfg.smtp.from,
      },
      branding: { accent: this.cfg.accent, logo: null, favicon: null },
      maintenance: { enabled: false, message: '' },
      defaultQuotaBytes: 0,
      backup: { enabled: true, time: this.cfg.backup.time, retention: { ...this.cfg.backup.retention } },
      setupCompletedAt: null,
      updatedAt: new Date(),
    };
    await this.d.c.settings.updateOne({ _id: 'platform' }, { $setOnInsert: doc }, { upsert: true });
    // A public address given in the environment wins until an administrator sets one.
    if (this.cfg.publicUrl) await this.d.c.settings.updateOne({ _id: 'platform', publicUrl: '' }, { $set: { publicUrl: this.cfg.publicUrl } });
    this.cache = null;
  }

  async get(): Promise<SettingsDoc> {
    if (this.cache && Date.now() - this.cache.at < 3000) return this.cache.doc;
    const doc = await this.d.c.settings.findOne({ _id: 'platform' });
    if (!doc) throw new Error('settings missing');
    this.cache = { at: Date.now(), doc };
    return doc;
  }

  invalidate(): void {
    this.cache = null;
  }

  smtpPassword(doc: SettingsDoc): string {
    return doc.smtp.passwordEnc ? decrypt(doc.smtp.passwordEnc, this.key) : '';
  }

  /** What an administrator sees: secrets replaced by whether they are set. */
  async masked() {
    const s = await this.get();
    const { passwordEnc, ...smtp } = s.smtp;
    return { ...s, smtp: { ...smtp, passwordSet: !!passwordEnc } };
  }

  /** Validates and applies a partial update from the admin panel; returns field errors. */
  async update(patch: Record<string, unknown>): Promise<{ errors: Record<string, string>; changed: string[] }> {
    const errors: Record<string, string> = {};
    const set: Record<string, unknown> = {};
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v.trim() : null);
    if ('appName' in patch) {
      const v = str(patch['appName'], 60);
      if (!v) errors['appName'] = 'Use 1-60 characters';
      else set['appName'] = v;
    }
    if ('publicUrl' in patch) {
      const v = str(patch['publicUrl'], 300)?.replace(/\/+$/, '') ?? null;
      const p = v === null ? 'Enter an address' : checkPublicUrl(v);
      if (p) errors['publicUrl'] = p;
      else set['publicUrl'] = v;
    }
    if ('registrationMode' in patch) {
      if (!REGISTRATION_MODES.includes(patch['registrationMode'] as never)) errors['registrationMode'] = 'Unknown mode';
      else set['registrationMode'] = patch['registrationMode'];
    }
    if ('defaultQuotaBytes' in patch) {
      const v = Number(patch['defaultQuotaBytes']);
      if (!Number.isFinite(v) || v < 0) errors['defaultQuotaBytes'] = 'Use 0 (no limit) or a positive size';
      else set['defaultQuotaBytes'] = Math.floor(v);
    }
    if (patch['maintenance'] && typeof patch['maintenance'] === 'object') {
      const m = patch['maintenance'] as Record<string, unknown>;
      set['maintenance'] = { enabled: !!m['enabled'], message: (str(m['message'] ?? '', 300) ?? '').slice(0, 300) };
    }
    if (patch['branding'] && typeof patch['branding'] === 'object') {
      const b = patch['branding'] as Record<string, unknown>;
      if ('accent' in b) {
        if (typeof b['accent'] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(b['accent'])) errors['branding.accent'] = 'Use a colour like #2f6fed';
        else set['branding.accent'] = b['accent'];
      }
    }
    if (patch['backup'] && typeof patch['backup'] === 'object') {
      const b = patch['backup'] as Record<string, unknown>;
      if ('enabled' in b) set['backup.enabled'] = !!b['enabled'];
      if ('time' in b) {
        if (typeof b['time'] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b['time'])) errors['backup.time'] = 'Use HH:MM';
        else set['backup.time'] = b['time'];
      }
      if (b['retention'] && typeof b['retention'] === 'object')
        for (const k of ['daily', 'weekly', 'monthly', 'manual']) {
          const v = (b['retention'] as Record<string, unknown>)[k];
          if (v === undefined) continue;
          if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 365) errors[`backup.retention.${k}`] = 'Use 0-365';
          else set[`backup.retention.${k}`] = v;
        }
    }
    if (patch['smtp'] && typeof patch['smtp'] === 'object') {
      const m = patch['smtp'] as Record<string, unknown>;
      if ('enabled' in m) set['smtp.enabled'] = !!m['enabled'];
      if ('host' in m) set['smtp.host'] = str(m['host'], 200) ?? '';
      if ('port' in m) {
        const p = Number(m['port']);
        if (!Number.isInteger(p) || p < 1 || p > 65535) errors['smtp.port'] = 'Use 1-65535';
        else set['smtp.port'] = p;
      }
      if ('secure' in m) set['smtp.secure'] = !!m['secure'];
      if ('user' in m) set['smtp.user'] = str(m['user'], 200) ?? '';
      if ('from' in m) {
        const f = str(m['from'], 200) ?? '';
        if (f && !/^[^\r\n<>]*<?[^@\s<>]+@[^@\s<>]+>?$/.test(f)) errors['smtp.from'] = 'Use an address like Noteboard <notes@example.com>';
        else set['smtp.from'] = f;
      }
      // An empty or missing password keeps the stored one; `clearPassword` removes it.
      if (typeof m['password'] === 'string' && m['password']) set['smtp.passwordEnc'] = encrypt(m['password'], this.key);
      if (m['clearPassword'] === true) set['smtp.passwordEnc'] = null;
      const cur = (await this.get()).smtp;
      const enabled = (set['smtp.enabled'] as boolean | undefined) ?? cur.enabled;
      const host = (set['smtp.host'] as string | undefined) ?? cur.host;
      const from = (set['smtp.from'] as string | undefined) ?? cur.from;
      if (enabled && (!host || !from)) errors['smtp'] = 'To turn e-mail on, fill in the server and the From address';
    }
    if (Object.keys(errors).length) return { errors, changed: [] };
    if (Object.keys(set).length) {
      set['updatedAt'] = new Date();
      await this.d.c.settings.updateOne({ _id: 'platform' }, { $set: set });
      this.invalidate();
    }
    return { errors, changed: Object.keys(set).filter((k) => k !== 'updatedAt' && k !== 'smtp.passwordEnc').concat('smtp.passwordEnc' in set ? ['smtp.password'] : []) };
  }
}
