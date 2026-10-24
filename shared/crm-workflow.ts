import type { CrmRecord, EntityKind } from './api.interface';
import type { Draft, FieldSpec } from './crm';
import { linkIds, planFields, textValue } from './crm';

export const progressFields: FieldSpec[] = [
  { key: '工作状态', type: 'select', required: true, options: ['待启动', '进行中', '暂停'] },
  { key: '当前进展', type: 'long', required: true },
  { key: '暂停原因', type: 'long' },
  ...planFields.map((f) => ({ ...f, required: false })),
  { key: '变更说明', type: 'long', required: true },
];

export function advancementBlocked(kind: EntityKind, row: CrmRecord): string {
  if (row.record['已归档'] === true) return '已归档，请先在飞书原表恢复';
  if (kind === 'project' && textValue(row.record['终局确认']) !== '未确认')
    return '项目已结束或终局状态异常，请先在飞书原表处理';
  return '';
}

export function followupTarget(row: CrmRecord): { kind: 'customer' | 'project'; id: string } | null {
  const direct = linkIds(row.record['直接客户']);
  const projects = linkIds(row.record['关联项目']);
  if (textValue(row.record['跟进归属']) === '客户直接跟进' && direct.length === 1 && !projects.length)
    return { kind: 'customer', id: direct[0] };
  if (textValue(row.record['跟进归属']) === '项目跟进' && projects.length === 1 && !direct.length)
    return { kind: 'project', id: projects[0] };
  return null;
}

export function relatedDraft(parentKind: 'customer' | 'project', parent: CrmRecord, kind: EntityKind): Draft {
  if (parentKind === 'customer' && (kind === 'contact' || kind === 'project'))
    return { 所属企业: [parent.id] };
  if (kind === 'followup') {
    const target: Draft = parentKind === 'customer'
      ? { 跟进归属: '客户直接跟进', 直接客户: [parent.id], 关联项目: [] }
      : { 跟进归属: '项目跟进', 关联项目: [parent.id], 直接客户: [] };
    // Historical entry must ask for the actual time, never default to "now".
    if (advancementBlocked(parentKind, parent)) {
      target['实际发生时间'] = null;
      target['后续安排'] = '无后续动作';
    }
    return target;
  }
  return {};
}
