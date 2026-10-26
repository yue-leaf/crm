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
import type { CrmSession, RelatedRecordsQuery } from '@shared/api.interface';
import { CrmService } from './crm.service';
import { crmAdmin } from '@shared/crm-access';

@Controller('api/crm')
@NeedLogin()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private session(req: Request, kind?: string): CrmSession {
    const { userId, userName, roles } = req.userContext ?? {};
    // The published app's Tenant visibility is the enterprise boundary. Every
    // logged-in member admitted by that boundary can use business operations.
    if (typeof userId !== 'string' || !userId.trim())
      throw new ForbiddenException('请使用本企业飞书账号登录');
    if (roles !== undefined && (!Array.isArray(roles) || !roles.every((role) => typeof role === 'string')))
      throw new ForbiddenException('登录身份信息异常，请重新进入应用');
    if (kind === 'access' && !crmAdmin(roles))
      throw new ForbiddenException('权限配置仅限管理员管理');
    return { userId, name: userName || '当前员工', roles };
  }

  @Get('session')
  current(@Req() req: Request): CrmSession {
    return this.session(req);
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

  @Get('customers/:id/projects')
  customerProjects(@Req() req: Request, @Param('id') id: string, @Query() query: RelatedRecordsQuery) {
    this.session(req);
    return this.crm.customerProjects(id, query);
  }

  @Get('customers/:id/followups')
  customerFollowups(@Req() req: Request, @Param('id') id: string, @Query() query: RelatedRecordsQuery) {
    this.session(req);
    return this.crm.relatedFollowups('customer', id, query);
  }

  @Get('projects/:id/followups')
  projectFollowups(@Req() req: Request, @Param('id') id: string, @Query() query: RelatedRecordsQuery) {
    this.session(req);
    return this.crm.relatedFollowups('project', id, query);
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
    @Query('followupFilter') followupFilter?: string,
  ) {
    const actor = this.session(req, kind);
    if (followupFilter !== undefined && kind !== 'customer' && kind !== 'project') throw new BadRequestException('跟进状态筛选仅用于客户或项目');
    if ((projectFilter !== undefined || scope !== undefined) && kind !== 'project') throw new BadRequestException('项目筛选仅用于项目列表');
    if (kind === 'customer') return this.crm.customerList(followupFilter ?? 'all', cursor, search);
    if (kind === 'project') {
      return this.crm.projectList(scope ?? 'all', projectFilter ?? 'all', cursor, search, actor.userId, followupFilter ?? 'all');
    }
    return this.crm.list(kind, cursor, search);
  }
}
