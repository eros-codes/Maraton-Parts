import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from './audit.service';
import {
  SecurityAlertKind,
  SecurityAlertsService,
} from './security-alerts.service';

// What counts as suspicious, recorded in the activity log under
// entity_type "security" so the panel's activity log shows them next to
// staff actions (filter: entityType=security).
export type SecurityEventAction =
  | 'security.login_locked'
  | 'security.refresh_token_reused'
  | 'security.otp_attempts_exceeded'
  | 'security.csrf_rejected'
  | 'security.admin_access_denied'
  | 'security.insecure_request_rejected'
  | 'security.admin_granted'
  | 'security.two_factor_enabled'
  | 'security.two_factor_disabled'
  | 'security.two_factor_reset';

// The same event for the same key is written at most once per window.
// Someone hammering an admin route with a customer token must not be able
// to fill the database through this log; every occurrence still reaches
// the application log.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const MAX_TRACKED_KEYS = 5000;

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('Security');
  private readonly lastWritten = new Map<string, number>();

  constructor(
    private readonly audit: AuditService,
    private readonly alerts: SecurityAlertsService,
  ) {}

  async record(
    action: SecurityEventAction,
    details: {
      key: string;
      userId?: number | null;
      ip?: string | null;
      [extra: string]: unknown;
    },
    // Also tell the owner right away (SMS / bot). Only for events that mean
    // someone may be in an admin account; see SecurityAlertsService.
    options: { alert?: SecurityAlertKind; subject?: string } = {},
  ): Promise<void> {
    const { key, userId, ...rest } = details;
    this.logger.warn(`${action} ${JSON.stringify({ key, userId, ...rest })}`);
    if (options.alert) {
      void this.alerts.send(
        options.alert,
        options.subject ?? key,
        typeof rest.ip === 'string' ? `IP: ${rest.ip}` : undefined,
      );
    }

    const dedupeKey = `${action}|${key}`;
    const now = Date.now();
    const last = this.lastWritten.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
    if (this.lastWritten.size >= MAX_TRACKED_KEYS) {
      for (const [k, at] of this.lastWritten) {
        if (now - at >= DEDUPE_WINDOW_MS) this.lastWritten.delete(k);
      }
      if (this.lastWritten.size >= MAX_TRACKED_KEYS) this.lastWritten.clear();
    }
    this.lastWritten.set(dedupeKey, now);

    await this.audit.record({
      action,
      entityType: 'security',
      entityId: userId ?? null,
      actor: userId ? { userId } : { label: key.slice(0, 100) },
      changes: { key, ...rest },
    });
  }
}
