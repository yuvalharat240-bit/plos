import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfirmationTokenService } from '../agent/tools/confirmation-token.service';
import { ConsentService } from './consent.service';
import { PermissionGrantsService } from './permission-grants.service';
import { ExportBundleStorageService } from './export-bundle-storage.service';
import { ExportBundleService } from './export-bundle.service';
import { AccountDeletionService } from './account-deletion.service';
import { PrivacyController } from './privacy.controller';
import { ExportDownloadController } from './export-download.controller';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [PrivacyController, ExportDownloadController],
  providers: [
    ConsentService,
    PermissionGrantsService,
    ExportBundleStorageService,
    ExportBundleService,
    AccountDeletionService,
    ConfirmationTokenService,
  ],
})
export class PrivacyModule {}
