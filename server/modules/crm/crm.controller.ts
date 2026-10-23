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
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { CrmSession } from '@shared/api.interface';
import { CrmService } from './crm.service';

@Controller('api/crm')
@NeedLogin()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private session(req: Request): CrmSession {
    const { userId, userName, roles } = req.userContext;
    if (!userId || roles === undefined || !roles.includes('crm_admin'))
      throw new ForbiddenException('当前账号尚未获得 CRM 管理员权限');
    return { userId, name: userName || '当前员工', roles };
  }

  @Get('session')
  current(@Req() req: Request): CrmSession {
    const { userId, userName, roles } = req.userContext;
    if (roles === undefined)
      throw new ForbiddenException('登录上下文缺少角色信息，请重新进入应用');
    return { userId, name: userName || '当前员工', roles };
  }

  @Get('summary')
  summary(@Req() req: Request) {
    this.session(req);
    return this.crm.summary();
  }

  @Post('records/:kind')
  create(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    this.session(req);
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
    const actor = this.session(req);
    return this.crm.update(kind, id, operation, body, actor.userId);
  }

  @Get('records/:kind/:id')
  detail(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    this.session(req);
    return this.crm.get(kind, id);
  }

  @Get('records/:kind')
  list(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
  ) {
    this.session(req);
    return this.crm.list(kind, cursor, search);
  }
}
