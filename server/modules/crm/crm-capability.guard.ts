import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/** CRM capabilities are server-only. Direct SDK endpoints bypass business validation. */
@Injectable()
export class CrmCapabilityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      ['WebhookController', 'DebugController'].includes(
        context.getClass().name,
      ) ||
      /(?:\/api\/capability|\/__innerapi__\/capability)(?:\/|$)/.test(
        request.path,
      )
    ) {
      throw new ForbiddenException('请通过 CRM 业务页面操作');
    }
    return true;
  }
}
