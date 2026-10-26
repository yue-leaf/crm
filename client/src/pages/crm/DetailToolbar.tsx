import React from 'react';
import { MoreHorizontal, Pencil, MessageSquarePlus, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { CrmRecord, EntityKind, CrmLifecycleOperation } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { advancementBlocked, followupTarget } from '@shared/crm-workflow';
import { editBlockedReason } from '@shared/crm-edit';
import { recordReviewProblem } from '@shared/crm-review';
import { lifecycleBlocked, lifecycleTitles } from '@shared/crm-lifecycle';

interface Props {
  kind: EntityKind;
  row: CrmRecord;
  busy: boolean;
  onEdit: () => void;
  onAction: (operation: string) => void;
  onFollowup: () => void;
  onTarget: () => void;
}
export function DetailToolbar({ kind, row, busy, onEdit, onAction, onFollowup, onTarget }: Props) {
  const business: boolean = kind === 'customer' || kind === 'project';
  const pending: boolean = textValue(row.record['核查标记']) === '待核查';
  const editReason: string = editBlockedReason(kind, row);
  const advanceReason: string = advancementBlocked(kind, row);
  const reviewReason: string = recordReviewProblem(kind, row.record);
  const lifecycle: CrmLifecycleOperation[] = (['confirm-end', 'archive', 'restore', 'reopen'] as CrmLifecycleOperation[])
    .filter((op: CrmLifecycleOperation) => !(kind === 'customer' && ['confirm-end', 'reopen'].includes(op)))
    .filter((op: CrmLifecycleOperation) => op === 'restore' ? row.record['已归档'] === true
      : op === 'archive' ? row.record['已归档'] !== true
      : op === 'confirm-end' ? textValue(row.record['终局确认']) === '未确认'
      : ['已完成', '已取消'].includes(textValue(row.record['终局确认'])));
  return <div className="detail-toolbar" aria-label="记录操作">
    <div className="detail-toolbar-primary">
      {pending && kind !== 'access' && <Button size="sm" disabled={busy || !!reviewReason}
        title={reviewReason || undefined} onClick={() => onAction('review')}><CheckCircle2 size={15} />核查通过</Button>}
      {business && !pending && <Button size="sm" disabled={busy || textValue(row.record['核查标记']) !== '正常'}
        onClick={onFollowup}><MessageSquarePlus size={15} />{advanceReason ? '补录历史跟进' : '记录跟进'}</Button>}
      {kind !== 'access' && <Button size="sm" variant="outline" disabled={busy || !!editReason}
        title={editReason || '编辑资料'} onClick={onEdit}><Pencil size={15} />编辑资料</Button>}
      {kind === 'followup' && followupTarget(row) && <Button size="sm" variant="outline" disabled={busy}
        onClick={onTarget}>查看所属对象<ArrowUpRight size={14} /></Button>}
    </div>
    {business && <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={busy}
      aria-label="更多操作"><MoreHorizontal size={17} />更多操作</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="crm-detail-menu">
        <DropdownMenuLabel>计划与推进</DropdownMenuLabel>
        <DropdownMenuItem disabled={!!advanceReason} title={advanceReason || undefined} onSelect={() => onAction('plan')}>调整当前计划</DropdownMenuItem>
        {kind === 'project' && <DropdownMenuItem disabled={!!advanceReason} title={advanceReason || undefined}
          onSelect={() => onAction('progress')}>更新项目进展</DropdownMenuItem>}
        {kind === 'project' && <DropdownMenuItem disabled={!!advanceReason} title={advanceReason || undefined}
          onSelect={() => onAction('suggest-end')}>提出结束建议</DropdownMenuItem>}
        <DropdownMenuSeparator /><DropdownMenuLabel>状态管理</DropdownMenuLabel>
        {lifecycle.map((operation: CrmLifecycleOperation) => {
          const blocked: string = lifecycleBlocked(kind, operation, row);
          return <DropdownMenuItem key={operation} disabled={!!blocked} title={blocked || undefined}
            onSelect={() => onAction(operation)}>{lifecycleTitles[operation]}{blocked && <span className="detail-menu-reason">{blocked}</span>}</DropdownMenuItem>;
        })}
      </DropdownMenuContent></DropdownMenu>}
  </div>;
}
