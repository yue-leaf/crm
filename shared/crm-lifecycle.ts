import type { CrmLifecycleOperation, CrmRecord, EntityKind } from './api.interface';
import type { FieldSpec } from './crm';
import { planFields, textValue } from './crm';

export const lifecycleTitles: Record<CrmLifecycleOperation, string> = {
  'confirm-end': '确认项目结束', archive: '归档', restore: '取消归档', reopen: '重开项目',
};
export function isLifecycle(operation: string): operation is CrmLifecycleOperation {
  return ['confirm-end', 'archive', 'restore', 'reopen'].includes(operation);
}
export function lifecycleFields(kind: EntityKind, operation: CrmLifecycleOperation): FieldSpec[] {
  const reason: FieldSpec = { key: '操作原因', type: 'long', required: true };
  if (operation === 'confirm-end') return [
    { key: '终局确认', type: 'select', required: true, options: ['已取消'] },
    { key: '结束日期', type: 'date', required: true },
    { key: '结果说明', type: 'long', required: true },
    { key: '取消原因', type: 'long' }, reason,
  ];
  if (operation === 'reopen') return [
    { key: '工作状态', type: 'select', required: true, options: ['待启动', '进行中', '暂停', '已签合同'] },
    { key: '当前进展', type: 'long', required: true },
    { key: '暂停原因', type: 'long' }, { key: '签约日期', type: 'date' },
    ...planFields.map(f => ({ ...f, required: false })), reason,
  ];
  return [...(operation === 'restore' && kind === 'customer' ? planFields : []), reason];
}
export function lifecycleBlocked(kind: EntityKind, operation: CrmLifecycleOperation, row: CrmRecord): string {
  if (kind !== 'customer' && kind !== 'project') return '此记录不支持该操作';
  const archived = row.record['已归档'] === true;
  const terminal = textValue(row.record['终局确认']);
  if (operation === 'restore') return archived ? '' : '记录尚未归档';
  if (operation === 'reopen') return kind === 'project' && ['已完成', '已取消'].includes(terminal)
    ? '' : '仅已完成或已取消的项目可以重开';
  if (archived) return '记录已归档，请先取消归档或重开项目';
  if (operation === 'confirm-end') return kind === 'project' && ['未确认', '已取消'].includes(terminal) ? '' : '仅未结项项目可以确认结束';
  if (kind === 'project' && !['已完成', '已取消'].includes(terminal) && textValue(row.record['工作状态']) !== '已签合同') return '项目签约或取消后才能归档';
  return '';
}

export interface LifecycleEvent {
  version: 1;
  operation: CrmLifecycleOperation;
  at: number;
  actor: string;
  reason: string;
  previous: { terminal: string; archived: boolean; endDate?: number; archiveTime?: number; action: string; dueDate?: number; result: string; suggestion: string; suggestionNote: string; cancelReason: string; archiveReason: string };
}
export const EVENT_PREFIX = 'CRM_LIFECYCLE_V1:';
/** User-authored lines must never be mistaken for machine event boundaries. */
export function auditNote(value: string): string {
  return value.split(/\r?\n/).map(line => `  ${line}`).join('\n');
}
export function lifecycleEvents(record: CrmRecord['record']): LifecycleEvent[] {
  const out: LifecycleEvent[] = [];
  for (const line of textValue(record['管理记录']).split('\n')) {
    if (!line.startsWith(EVENT_PREFIX)) continue;
    try {
      const value: unknown = JSON.parse(line.slice(EVENT_PREFIX.length));
      if (!value || typeof value !== 'object') continue;
      const e = value as LifecycleEvent;
      if (e.version === 1 && isLifecycle(e.operation) && typeof e.at === 'number' && Number.isFinite(e.at) &&
        e.previous && typeof e.previous.archived === 'boolean' && typeof e.previous.terminal === 'string') out.push(e);
    } catch { /* Existing notes remain visible, but cannot establish a history interval. */ }
  }
  return out.sort((a, b) => a.at - b.at);
}
/** Reject newly recorded events in known inactive intervals, even after reopening. */
export function inactiveAt(record: CrmRecord['record'], occurred: number): boolean {
  return lifecycleEvents(record).some(e => {
    if (e.operation !== 'restore' && e.operation !== 'reopen') return false;
    const archive = e.previous.archived && typeof e.previous.archiveTime === 'number' ? e.previous.archiveTime : Infinity;
    const closed = e.operation === 'reopen' && typeof e.previous.endDate === 'number'
      ? (Math.floor((e.previous.endDate + 8 * 3600000) / 86400000) + 1) * 86400000 - 8 * 3600000 : Infinity;
    const boundary = Math.min(archive, closed);
    if (!Number.isFinite(boundary)) return false;
    return occurred >= boundary && occurred < e.at;
  });
}
