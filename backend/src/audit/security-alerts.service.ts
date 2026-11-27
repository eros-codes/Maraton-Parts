import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsService } from '../sms/sms.service';

// Tells the shop owner, right away, about the few events that mean someone
// may be inside an admin account. Two channels, both optional:
//
//  - SMS through sms.ir: SECURITY_ALERT_MOBILES (comma-separated) and an
//    approved template SMSIR_SECURITY_ALERT_TEMPLATE_ID with one parameter,
//    EVENT ("هشدار امنیتی ماراتون پارتز: #EVENT#").
//  - A bot message: ALERT_BOT_TOKEN + ALERT_BOT_CHAT_ID. ALERT_BOT_API is
//    Bale's Telegram-compatible API by default (reachable from Iranian
//    servers); set it to https://api.telegram.org for Telegram.
//
// Never more than one alert for the same thing per half hour, and never
// more than MAX_ALERTS_PER_DAY in all, so an attack cannot run up the SMS
// bill or bury the owner's phone.

export type SecurityAlertKind =
  | 'admin_login_locked'
  | 'admin_session_stolen'
  | 'admin_granted'
  | 'two_factor_disabled'
  | 'two_factor_reset'
  | 'two_factor_enabled';

// Short enough for an SMS template parameter.
const LABELS: Record<SecurityAlertKind, string> = {
  admin_login_locked: 'قفل ورود حساب ادمین',
  admin_session_stolen: 'سرقت احتمالی نشست ادمین',
  admin_granted: 'دسترسی ادمین به حساب جدید',
  two_factor_disabled: 'خاموش شدن ورود دومرحله‌ای',
  two_factor_reset: 'ریست ورود دومرحله‌ای',
  two_factor_enabled: 'فعال شدن ورود دومرحله‌ای',
};

const REPEAT_WINDOW_MS = 30 * 60 * 1000;
const MAX_ALERTS_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SecurityAlertsService {
  private readonly logger = new Logger('SecurityAlerts');
  private readonly lastSent = new Map<string, number>();
  private sentToday: number[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly sms: SmsService,
  ) {}

  get channels(): string[] {
    const list: string[] = [];
    if (this.recipients().length && this.templateId()) list.push('sms');
    if (this.botToken() && this.botChat()) list.push('bot');
    return list;
  }

  // Returns whether anything went out. Never throws: an alert that cannot
  // be sent must not break the request that triggered it.
  async send(
    kind: SecurityAlertKind,
    subject: string,
    detail?: string,
  ): Promise<boolean> {
    if (!this.channels.length) return false;

    const now = Date.now();
    const key = `${kind}|${subject}`;
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
    this.sentToday = this.sentToday.filter((at) => now - at < DAY_MS);
    if (this.sentToday.length >= MAX_ALERTS_PER_DAY) {
      this.logger.warn(`Daily alert cap reached - not sending ${kind}`);
      return false;
    }
    this.lastSent.set(key, now);
    this.sentToday.push(now);

    const label = LABELS[kind];
    const results = await Promise.allSettled([
      this.sendSms(label),
      this.sendBot(
        [
          `⚠️ هشدار امنیتی ماراتون پارتز`,
          label,
          subject ? `مربوط به: ${subject}` : '',
          detail ?? '',
          new Date(now).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    ]);
    const delivered = results.some(
      (result) => result.status === 'fulfilled' && result.value,
    );
    if (!delivered) this.logger.error(`Could not deliver the ${kind} alert`);
    return delivered;
  }

  private recipients(): string[] {
    return (this.config.get<string>('SECURITY_ALERT_MOBILES') ?? '')
      .split(',')
      .map((mobile) => mobile.trim())
      .filter(Boolean);
  }

  private templateId(): string {
    return this.config.get<string>('SMSIR_SECURITY_ALERT_TEMPLATE_ID') ?? '';
  }

  private botToken(): string {
    return this.config.get<string>('ALERT_BOT_TOKEN') ?? '';
  }

  private botChat(): string {
    return this.config.get<string>('ALERT_BOT_CHAT_ID') ?? '';
  }

  private async sendSms(label: string): Promise<boolean> {
    const templateId = this.templateId();
    const recipients = this.recipients();
    if (!templateId || !recipients.length) return false;
    const results = await Promise.all(
      recipients.map((mobile) =>
        this.sms.sendTemplate(mobile, templateId, { EVENT: label }),
      ),
    );
    for (const result of results) {
      if (!result.delivered) this.logger.error(`Alert SMS: ${result.error}`);
    }
    return results.some((result) => result.delivered);
  }

  private async sendBot(text: string): Promise<boolean> {
    const token = this.botToken();
    const chat = this.botChat();
    if (!token || !chat) return false;
    const base = (
      this.config.get<string>('ALERT_BOT_API') || 'https://tapi.bale.ai'
    ).replace(/\/+$/, '');
    try {
      const response = await fetch(`${base}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.error(`Alert bot answered HTTP ${response.status}`);
      }
      return response.ok;
    } catch (error) {
      this.logger.error(`Alert bot request failed: ${String(error)}`);
      return false;
    }
  }
}
