import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmCapabilityGuard } from './crm-capability.guard';

@Module({
  controllers: [CrmController],
  providers: [CrmService, { provide: APP_GUARD, useClass: CrmCapabilityGuard }],
})
export class CrmModule {}
