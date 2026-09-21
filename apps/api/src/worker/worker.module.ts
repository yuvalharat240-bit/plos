import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BaselineService } from './baseline.service';
import { CalendarDensityService } from './calendar-density.service';

@Module({
  imports: [DatabaseModule],
  providers: [BaselineService, CalendarDensityService],
  exports: [BaselineService, CalendarDensityService],
})
export class WorkerModule {}
