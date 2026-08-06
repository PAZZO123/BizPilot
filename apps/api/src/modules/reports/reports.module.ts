import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportPdfService } from './report-pdf.service';
import { ReportsController } from './reports.controller';

@Module({
  providers: [ReportsService, ReportPdfService],
  controllers: [ReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
