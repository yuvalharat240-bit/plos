import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [JournalController],
  providers: [JournalService],
})
export class JournalModule {}
