import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { CrmNotificationsService } from './crm-notifications.service';

@Automation()
export class CrmAutomation {
  constructor(private readonly notifications: CrmNotificationsService) {}

  @BindTrigger('crmDailyReminder')
  async dailyReminder(): Promise<void> {
    await this.notifications.run();
  }
}
