import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { Request } from 'express';
import { CrmDeletionService } from './crm-deletion.service';

/** Serialize app mutations with deletion batches across instances. Base-side edits are checked separately. */
@Injectable()
export class CrmMutationInterceptor implements NestInterceptor {
  constructor(private readonly deletions: CrmDeletionService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (context.getClass().name !== 'CrmController' || !['create','update'].includes(context.getHandler().name)) return next.handle();
    return from(this.deletions.exclusive(async () => {
      await this.deletions.guardMutation(req.body, typeof req.params.id === 'string' ? req.params.id : undefined);
      return lastValueFrom(next.handle());
    }));
  }
}
