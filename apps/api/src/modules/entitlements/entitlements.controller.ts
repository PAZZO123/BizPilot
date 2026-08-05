import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PLANS, PLAN_ORDER } from '@bizpilot/shared';
import { BusinessId, Public } from '../../common/decorators';
import { EntitlementsService } from './entitlements.service';

@ApiTags('plans')
@Controller()
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Public pricing table' })
  listPlans() {
    return { plans: PLAN_ORDER.map((id) => PLANS[id]) };
  }

  @Get('me/entitlements')
  @ApiOperation({ summary: "Current plan, limits and this month's usage" })
  mine(@BusinessId() businessId: string) {
    return this.entitlements.summary(businessId);
  }
}
