import type { CrmRecord } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { reject } from './crm-validation';
import { inactiveAt } from '@shared/crm-lifecycle';

/** Date-only close boundaries include the entire Shanghai calendar day. */
export function historicalContext(kind: 'customer' | 'project', row: CrmRecord, occurred: number): void {
  const label = kind === 'customer' ? '所属企业' : '关联项目';
  if (textValue(row.record['核查标记']) !== '正常') reject(label, '请先核查通过');
  if (!Number.isFinite(occurred) || occurred > Date.now()) reject('实际发生时间', '时间无效或晚于当前时间');
  if (inactiveAt(row.record, occurred)) reject('实际发生时间', '该时间位于已记录的结束或归档区间，请核对真实发生时间');
  if (kind === 'project') {
    const terminal = textValue(row.record['终局确认']);
    if (!['未确认', '已完成', '已取消'].includes(terminal)) reject(label, '终局状态异常，请在原表核对');
    if (row.record['已归档'] === true && terminal === '未确认') reject(label, '归档项目尚未结项，请在原表核对');
    if (terminal === '未确认' && !['待启动', '进行中', '暂停'].includes(textValue(row.record['工作状态'])))
      reject(label, '工作状态异常，请先更新项目进展');
    if (terminal !== '未确认') {
      const closed = row.record['结束日期'];
      if (typeof closed !== 'number' || !Number.isFinite(closed)) reject(label, '结束日期缺失，无法确认历史补录范围');
      const day = (ms: number) => Math.floor((ms + 8 * 3600000) / 86400000);
      if (day(closed) > day(Date.now()) || day(occurred) > day(closed))
        reject(label, '仅能补录结束日期当天及之前的历史工作；新工作请先重开项目');
    }
  }
  if (row.record['已归档'] === true) {
    const archived = row.record['归档时间'];
    if (typeof archived !== 'number' || !Number.isFinite(archived)) reject(label, '归档时间缺失，无法确认历史补录范围');
    if (archived > Date.now()) reject(label, '归档时间晚于当前时间，请先在原表核对');
    if (occurred >= archived) reject(label, '仅能补录归档时间之前的历史工作；新工作请先恢复');
  }
}
