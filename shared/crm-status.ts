import type { FieldSpec } from './crm';
import { planFields, textValue } from './crm';
import type { CrmRecord } from './api.interface';
export const projectStatusOptions = ['待启动', '进行中', '暂停', '已签合同', '已取消'];
export const statusFields: FieldSpec[] = [
  { key: '项目状态', type: 'select', required: true, options: projectStatusOptions },
  { key: '当前进展', type: 'long' },
  { key: '暂停原因', type: 'long' },
  { key: '签约日期', type: 'date' },
  ...planFields.map(f => ({ ...f, required: false })),
  { key: '结束日期', label: '取消日期', type: 'date' },
  { key: '取消原因', type: 'long' },
];
export const projectEditStatusFields: FieldSpec[] = statusFields.filter(
  (field: FieldSpec) => !planFields.some((plan: FieldSpec) => plan.key === field.key),
);
export function currentProjectStatus(row: CrmRecord): string {
  const terminal = textValue(row.record['终局确认']);
  return terminal === '已取消' ? terminal : terminal === '已完成' ? '已签合同' : textValue(row.record['工作状态']);
}
