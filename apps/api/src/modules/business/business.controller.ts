import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BusinessId, CurrentUser, Roles } from '../../common/decorators';
import { BusinessService } from './business.service';
import {
  CreateLocationDto,
  UpdateBusinessDto,
  UpdateLocationDto,
  UpdateUserDto,
} from './dto/business.dto';

@ApiTags('business')
@ApiBearerAuth()
@Controller('business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get()
  @ApiOperation({ summary: 'Business profile and settings' })
  profile(@BusinessId() businessId: string) {
    return this.business.profile(businessId);
  }

  @Patch()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update business settings' })
  update(@BusinessId() businessId: string, @Body() dto: UpdateBusinessDto) {
    return this.business.update(businessId, dto);
  }

  @Get('users')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'List staff accounts' })
  listUsers(@BusinessId() businessId: string) {
    return this.business.listUsers(businessId);
  }

  @Patch('users/:id')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Update a staff account' })
  updateUser(
    @BusinessId() businessId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.business.updateUser(businessId, actorId, id, dto);
  }

  @Delete('users/:id')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Remove a staff account' })
  removeUser(
    @BusinessId() businessId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.business.removeUser(businessId, actorId, id);
  }

  @Get('locations')
  @ApiOperation({ summary: 'List branches' })
  listLocations(@BusinessId() businessId: string) {
    return this.business.listLocations(businessId);
  }

  @Post('locations')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Add a branch' })
  createLocation(@BusinessId() businessId: string, @Body() dto: CreateLocationDto) {
    return this.business.createLocation(businessId, dto);
  }

  @Patch('locations/:id')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Update a branch' })
  updateLocation(
    @BusinessId() businessId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.business.updateLocation(businessId, id, dto);
  }

  @Delete('locations/:id')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Remove a branch' })
  removeLocation(@BusinessId() businessId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.business.removeLocation(businessId, id);
  }
}
