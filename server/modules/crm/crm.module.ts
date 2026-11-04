import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CrmDeletionService } from './crm-deletion.service';
import { CrmDeletionController } from './crm-deletion.controller';
import { CrmMutationInterceptor } from './crm-mutation.interceptor';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmCapabilityGuard } from './crm-capability.guard';
import { CrmNotificationsController } from './crm-notifications.controller';
import { CrmNotificationsService } from './crm-notifications.service';
import { CrmAutomation } from './crm.automation';
import { CrmFollowupWrites, CrmFollowupWriteStore } from './crm-followup-writes';

@Module({
  controllers: [CrmNotificationsController, CrmController, CrmDeletionController],
  providers: [CrmService, CrmDeletionService, CrmNotificationsService, CrmAutomation, CrmFollowupWrites, CrmFollowupWriteStore,
    { provide: APP_INTERCEPTOR, useClass: CrmMutationInterceptor }, { provide: APP_GUARD, useClass: CrmCapabilityGuard }],
})
export class CrmModule {}
