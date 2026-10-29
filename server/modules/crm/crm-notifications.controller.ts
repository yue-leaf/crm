import { Body, Controller, ForbiddenException, Get, Patch, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { crmAdmin } from '@shared/crm-access';
import { CrmNotificationsService } from './crm-notifications.service';

@Controller('api/crm/notifications')
@NeedLogin()
export class CrmNotificationsController {
  constructor(private readonly notices: CrmNotificationsService) {}
  private admin(req: Request): string {
    const { userId, roles } = req.userContext ?? {};
    if (typeof userId !== 'string' || !userId || !Array.isArray(roles) || !crmAdmin(roles))
      throw new ForbiddenException('通知设置仅限管理员管理');
    return userId;
  }
  @Get()
  state(@Req() req: Request) { this.admin(req); return this.notices.state(); }
  @Patch()
  save(@Req() req: Request, @Body() body: unknown) {
    const actorId = this.admin(req);
    return this.notices.save(body, actorId);
  }
  @Get('preview')
  preview(@Req() req: Request) { this.admin(req); return this.notices.preview(); }
  @Post('test')
  test(@Req() req: Request, @Body() body: { requestId?: unknown }) {
    const actorId = this.admin(req);
    return this.notices.test(actorId, body?.requestId);
  }
}
