import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { CrmSession } from '@shared/api.interface';
import { CrmService } from './crm.service';
import { crmAdmin, crmEmployee } from '@shared/crm-access';

@Controller('api/crm')
@NeedLogin()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private session(req: Request, kind?: string): CrmSession {
    const { userId, userName, roles } = req.userContext ?? {};
    if (!userId || !Array.isArray(roles) || !roles.every((role) => typeof role === 'string') || !crmEmployee(roles))
      throw new ForbiddenException('当前账号尚未获得 CRM 员工或管理员权限');
    if (kind === 'access' && !crmAdmin(roles))
      throw new ForbiddenException('权限配置仅限管理员管理');
    return { userId, name: userName || '当前员工', roles };
  }

  @Get('session')
  current(@Req() req: Request): CrmSession {
    const { userId, userName, roles } = req.userContext ?? {};
    if (!userId || !Array.isArray(roles) || !roles.every((role) => typeof role === 'string'))
      throw new ForbiddenException('登录上下文缺少角色信息，请重新进入应用');
    return { userId, name: userName || '当前员工', roles };
  }

  @Get('summary')
  summary(@Req() req: Request) {
    this.session(req);
    return this.crm.summary();
  }

  @Get('customers/:id/contacts')
  customerContacts(@Req() req: Request, @Param('id') id: string, @Query('cursor') cursor?: string) {
    this.session(req);
    return this.crm.customerContacts(id, cursor);
  }

  @Get('overview')
  overview(@Req() req: Request, @Query('scope') scope = 'all') {
    const actor = this.session(req);
    return this.crm.overview(scope, actor.userId);
  }

  @Post('records/:kind')
  create(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    this.session(req, kind);
    return this.crm.create(kind, body);
  }

  @Patch('records/:kind/:id/:operation')
  update(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Param('operation') operation: string,
    @Body() body: unknown,
  ) {
    const actor = this.session(req, kind);
    return this.crm.update(kind, id, operation, body, actor.userId);
  }

  @Get('records/:kind/:id')
  detail(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    this.session(req, kind);
    return this.crm.get(kind, id);
  }

  @Get('records/:kind')
  list(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('projectFilter') projectFilter?: string,
    @Query('scope') scope?: string,
  ) {
    const actor = this.session(req, kind);
    if (projectFilter !== undefined || scope !== undefined) {
      if (kind !== 'project') throw new BadRequestException('项目筛选仅用于项目列表');
      return this.crm.projectList(scope ?? 'all', projectFilter ?? 'all', cursor, search, actor.userId);
    }
    return this.crm.list(kind, cursor, search);
  }
}
