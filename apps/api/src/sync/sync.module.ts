import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SyncController } from './sync.controller';
import { HealthSyncService } from './health-sync.service';
import { CalendarSyncService } from './calendar-sync.service';
import { ImportService } from './import.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [SyncController],
  providers: [ImportService, HealthSyncService, CalendarSyncService],
})
export class SyncModule {}
