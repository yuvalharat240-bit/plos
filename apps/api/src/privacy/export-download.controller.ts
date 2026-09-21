import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExportBundleStorageService } from './export-bundle-storage.service';

/**
 * The "presigned URL" endpoint — deliberately outside `AuthGuard`. A real
 * S3 presigned URL doesn't require the caller's own bearer session token
 * either; the whole point is a link usable on its own for a bounded
 * window. Authorization here comes entirely from possessing a valid,
 * unexpired signed token (`ExportBundleStorageService`), which is exactly
 * as strong a guarantee as an S3 presigned URL provides.
 */
@Controller('v1/privacy/exports')
export class ExportDownloadController {
  constructor(private readonly storage: ExportBundleStorageService) {}

  @Get('download')
  async download(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const verified = token ? await this.storage.verifyDownloadToken(token) : null;
    if (!verified) {
      throw new NotFoundException('invalid or expired download link');
    }
    const data = await this.storage.read(verified.ref);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="plos-export.zip"`);
    res.send(data);
  }
}
