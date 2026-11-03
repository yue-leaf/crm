import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmCapabilityGuard } from './crm-capability.guard';
import { CrmNotificationsController } from './crm-notifications.controller';
import { CrmNotificationsService } from './crm-notifications.service';
import { CrmAutomation } from './crm.automation';
import { CrmFollowupWrites, CrmFollowupWriteStore } from './crm-followup-writes';

@Module({
  controllers: [CrmNotificationsController, CrmController],
  providers: [CrmService, CrmNotificationsService, CrmAutomation, CrmFollowupWrites, CrmFollowupWriteStore, { provide: APP_GUARD, useClass: CrmCapabilityGuard }],
})
export class CrmModule {}
