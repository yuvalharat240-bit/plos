import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { ImportService } from './import.service';
import { CalendarSyncDto } from './dto/calendar-sync.dto';
import { SyncResult } from './health-sync.service';

/** docs/09 Milestone 3 — client-driven EventKit sync, density signal only (see the DTO's own header for why no title is stored). */
@Injectable()
export class CalendarSyncService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly importSvc: ImportService,
    private readonly auditLog: AuditLogService,
  ) {}

  async sync(userId: string, dto: CalendarSyncDto): Promise<SyncResult> {
    return this.db.runAsUser(userId, async (client) => {
      let inserted = 0;
      let skipped = 0;

      for (const e of dto.events) {
        const id = await this.importSvc.insertSpineIfNew(
          client,
          userId,
          'event',
          'calendar_event',
          'apple_calendar',
          e.sourceId,
          e.startsAt,
        );
        if (!id) {
          skipped++;
          continue;
        }
        await client.query(
          `INSERT INTO events (id, user_id, domain, event_type, starts_at, ends_at, status)
           VALUES ($1, $2, 'productivity', 'calendar_item', $3, $4, 'completed')`,
          [id, userId, e.startsAt, e.endsAt ?? null],
        );
        await client.query(
          `INSERT INTO event_calendar_item (event_id, calendar_provider, external_event_id, attendee_count, is_focus_block)
           VALUES ($1, 'apple_calendar', $2, $3, $4)`,
          [id, e.sourceId, e.attendeeCount ?? null, e.isFocusBlock ?? false],
        );
        inserted++;
      }

      // See health-sync.service.ts's identical comment — the same real,
      // found gap (docs/08 §4.1 vs. nothing ever populating `integrations`).
      await client.query(
        `INSERT INTO integrations (user_id, provider, status, connected_at, last_sync_at, last_sync_status)
         VALUES ($1, 'apple_calendar', 'connected', now(), now(), 'success')
         ON CONFLICT (user_id, provider)
         DO UPDATE SET status = 'connected', last_sync_at = now(), last_sync_status = 'success'`,
        [userId],
      );

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'sync.calendar',
        resourceType: 'events',
        result: 'success',
        metadata: { inserted, skipped, total: dto.events.length },
      });

      return { inserted, skipped };
    });
  }
}
