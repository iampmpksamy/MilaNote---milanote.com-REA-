/** Optional e-mail. When SMTP is off, nothing is sent and administrators share links by hand. */
import nodemailer from 'nodemailer';
import type { SettingsDoc } from '../db';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  /** Messages sent through the test transport (MAIL_TRANSPORT=memory), for automated tests. */
  readonly sent: Message[] = [];
  constructor(private readonly testMode = process.env['MAIL_TRANSPORT'] === 'memory') {}

  enabled(s: SettingsDoc): boolean {
    return s.smtp.enabled && !!s.smtp.host && !!s.smtp.from;
  }

  async send(s: SettingsDoc, password: string, m: Message): Promise<void> {
    if (!this.enabled(s)) throw new Error('E-mail is turned off');
    if (this.testMode) {
      this.sent.push(m);
      return;
    }
    const t = nodemailer.createTransport({
      host: s.smtp.host,
      port: s.smtp.port,
      secure: s.smtp.secure,
      auth: s.smtp.user ? { user: s.smtp.user, pass: password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await t.sendMail({ from: s.smtp.from, to: m.to, subject: m.subject, text: m.text });
  }
}
