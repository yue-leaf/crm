import { Pencil, MessageSquarePlus, ArrowUpRight } from 'lucide-react';
import { ActionButton as Button } from './ActionButton';
import type { CrmRecord, EntityKind } from '@shared/api.interface';
import { advancementBlocked, followupTarget } from '@shared/crm-workflow';
import { editBlockedReason } from '@shared/crm-edit';

interface Props {
  kind: EntityKind;
  row: CrmRecord;
  busy: boolean;
  onEdit: () => void | Promise<void>;
  onFollowup: () => void;
  onTarget: () => void | Promise<void>;
}
export function DetailToolbar({ kind, row, busy, onEdit, onFollowup, onTarget }: Props) {
  const business: boolean = kind === 'customer' || kind === 'project';
  const editReason: string = editBlockedReason(kind, row);
  const advanceReason: string = advancementBlocked(kind, row);
  return <div className="detail-toolbar" aria-label="记录操作">
    <div className="detail-toolbar-primary">
      {business && <Button size="sm" disabled={busy}
        onClick={onFollowup}><MessageSquarePlus size={15} />{advanceReason ? '补录历史跟进' : '记录跟进'}</Button>}
      {kind !== 'access' && <Button size="sm" variant="outline" disabled={busy || !!editReason}
        title={editReason || '编辑资料'} onClick={onEdit}><Pencil size={15} />编辑资料</Button>}
      {kind === 'followup' && followupTarget(row) && <Button size="sm" variant="outline" disabled={busy}
        onClick={onTarget}>查看{followupTarget(row)?.kind === 'project' ? '项目' : '客户'}<ArrowUpRight size={14} /></Button>}
    </div>

  </div>;
}
