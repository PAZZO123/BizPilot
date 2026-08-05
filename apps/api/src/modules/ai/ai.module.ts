import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { AiController } from './ai.controller';
import { ReportsModule } from '../reports/reports.module';
import { ProductsModule } from '../products/products.module';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [ReportsModule, ProductsModule, ExpensesModule],
  providers: [AiService, AiToolsService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
