import React from 'react';
import { MoreHorizontal, Pencil, MessageSquarePlus, ArrowUpRight, Archive, ArchiveRestore, RotateCcw, CheckCircle2, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ActionButton as Button } from './ActionButton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { CrmRecord, EntityKind, CrmLifecycleOperation } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { advancementBlocked, followupTarget } from '@shared/crm-workflow';
import { editBlockedReason } from '@shared/crm-edit';
import { lifecycleBlocked, lifecycleTitles } from '@shared/crm-lifecycle';

interface Props {
  kind: EntityKind;
  row: CrmRecord;
  busy: boolean;
  onEdit: () => void | Promise<void>;
  onAction: (operation: string) => void | Promise<void>;
  onFollowup: () => void;
  onTarget: () => void | Promise<void>;
}
interface ToolbarAction {
  operation: string;
  label: string;
  icon: LucideIcon;
}
const lifecycleIcons: Record<CrmLifecycleOperation, LucideIcon> = {
  'confirm-end': CheckCircle2, archive: Archive, restore: ArchiveRestore, reopen: RotateCcw,
};
export function DetailToolbar({ kind, row, busy, onEdit, onAction, onFollowup, onTarget }: Props) {
  const business: boolean = kind === 'customer' || kind === 'project';
  const editReason: string = editBlockedReason(kind, row);
  const advanceReason: string = advancementBlocked(kind, row);
  const lifecycle: CrmLifecycleOperation[] = (['confirm-end', 'archive', 'restore', 'reopen'] as CrmLifecycleOperation[])
    .filter((op: CrmLifecycleOperation) => !(kind === 'customer' && ['confirm-end', 'reopen'].includes(op)))
    .filter((op: CrmLifecycleOperation) => op === 'restore' ? row.record['已归档'] === true
      : op === 'archive' ? row.record['已归档'] !== true
      : op === 'confirm-end' ? textValue(row.record['终局确认']) === '未确认'
      : ['已完成', '已取消'].includes(textValue(row.record['终局确认'])));
  const stateActions: ToolbarAction[] = business ? lifecycle
    .filter((operation: CrmLifecycleOperation) => !lifecycleBlocked(kind, operation, row))
    .map((operation: CrmLifecycleOperation) => ({ operation, label: lifecycleTitles[operation], icon: lifecycleIcons[operation] })) : [];
  const actions: ToolbarAction[] = stateActions;
  const groups = [
    { label: '状态管理', actions: stateActions },
  ].filter(group => group.actions.length > 0);
  return <div className="detail-toolbar" aria-label="记录操作">
    <div className="detail-toolbar-primary">
      {business && <Button size="sm" disabled={busy}
        onClick={onFollowup}><MessageSquarePlus size={15} />{advanceReason ? '补录历史跟进' : '记录跟进'}</Button>}
      {kind === 'project' && <Button size="sm" variant="outline" disabled={busy || !!advanceReason}
        title={advanceReason || undefined} onClick={() => onAction('progress')}><TrendingUp size={15} />更新进展</Button>}
      {kind === 'customer' && <Button size="sm" variant="outline" disabled={busy || !!advanceReason}
        title={advanceReason || undefined} onClick={() => onAction('plan')}>调整计划</Button>}
      {kind !== 'access' && <Button size="sm" variant="outline" disabled={busy || !!editReason}
        title={editReason || '编辑资料'} onClick={onEdit}><Pencil size={15} />编辑资料</Button>}
      {kind === 'followup' && followupTarget(row) && <Button size="sm" variant="outline" disabled={busy}
        onClick={onTarget}>查看{followupTarget(row)?.kind === 'project' ? '项目' : '客户'}<ArrowUpRight size={14} /></Button>}
    </div>
    {actions.length > 0 && <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="detail-toolbar-secondary" disabled={busy}
      aria-label="更多操作"><MoreHorizontal size={17} />更多操作</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="crm-detail-menu">
        {groups.map((group, index) => <React.Fragment key={group.label}>
          {index > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          {group.actions.map((action: ToolbarAction) => <DropdownMenuItem key={action.operation} disabled={busy}
            onSelect={() => onAction(action.operation)}><action.icon size={15} aria-hidden="true" />{action.label}</DropdownMenuItem>)}
        </React.Fragment>)}
      </DropdownMenuContent></DropdownMenu>}
  </div>;
}
