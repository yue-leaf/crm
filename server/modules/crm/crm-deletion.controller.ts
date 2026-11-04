import { Body, Controller, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { crmAdmin } from '@shared/crm-access';
import { CrmDeletionService } from './crm-deletion.service';

@Controller('api/crm/deletions')
@NeedLogin()
export class CrmDeletionController {
  constructor(private readonly deletions: CrmDeletionService) {}
  private admin(req: Request): string {
    const context = req.userContext;
    if (!context?.userId || !crmAdmin(context.roles)) throw new ForbiddenException('删除仅限管理员操作');
    return context.userId;
  }
  @Get()
  pending(@Req() req: Request) { this.admin(req); return this.deletions.pending(); }
  @Post('preview')
  preview(@Req() req: Request, @Body() body: {kind:string; id:string}) {
    const actor = this.admin(req); return this.deletions.preview(body?.kind,body?.id,actor);
  }
  @Get(':id')
  inspect(@Req() req: Request,@Param('id') id:string) { this.admin(req); return this.deletions.inspect(id); }
  @Post(':id/step')
  step(@Req() req: Request,@Param('id') id:string) { this.admin(req); return this.deletions.step(id); }
}
