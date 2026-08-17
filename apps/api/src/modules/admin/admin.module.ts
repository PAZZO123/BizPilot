import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminManagementController } from './admin-management.controller';
import { AdminManagementService } from './admin-management.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';

/**
 * Reading and writing live in the same module but different files: the console
 * needs both, while the code that can suspend an account stays separable from
 * the code that draws a revenue chart.
 *
 * AuthModule is here for session revocation and BillingModule for settling a
 * payment by hand — both already solved problems, and re-implementing either
 * inside the admin console is how the two paths drift apart.
 */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [AdminController, AdminManagementController],
  providers: [AdminService, AdminManagementService, PlatformAdminGuard],
})
export class AdminModule {}
