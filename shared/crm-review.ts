import type { CrmRecord, EntityKind } from './api.interface';
import { textValue } from './crm';
import { projectReviewProblem } from './crm-workflow';

export function contactLifecycleProblem(record: CrmRecord['record'], now = Date.now()): string {
  const status = textValue(record['联系人状态']);
  if (!['有效', '停用'].includes(status)) return '联系人状态异常，请在原表核对';
  if (status === '有效') {
    if (record['停用时间'] != null || textValue(record['停用原因']).trim())
      return '有效联系人残留停用信息，请在原表完成恢复核查';
  } else {
    const disabled = record['停用时间'];
    if (typeof disabled !== 'number' || !Number.isFinite(disabled) || disabled > now)
      return '停用时间缺失或晚于当前时间，请在原表核对';
    if (!textValue(record['停用原因']).trim()) return '停用原因缺失，请在原表补齐';
  }
  return '';
}

/** Shared review gate; related records and directory checks still run on the server. */
export function recordReviewProblem(kind: EntityKind, record: CrmRecord['record'], now = Date.now()): string {
  const computed = textValue(record['数据检查']).trim();
  if (computed) return `数据检查未通过：${computed}。纠正后请刷新，等待飞书重新计算`;
  if (kind === 'project') return projectReviewProblem(record, now);
  if (kind === 'contact') return contactLifecycleProblem(record, now);
  if (kind === 'followup') {
    const status = textValue(record['记录状态']);
    if (!['正常', '已作废'].includes(status)) return '记录状态异常，请在原表核对';
    if (status === '已作废' && !textValue(record['作废原因']).trim()) return '作废原因缺失，请在原表补齐';
  }
  if (kind === 'customer') {
    if (!['待建立', '接洽中', '合作中', '暂停合作', '结束合作'].includes(textValue(record['客户关系状态'])))
      return '客户关系状态异常，请在原表核对';
    const action = textValue(record['当前下一步行动']).trim();
    const date = record['下次跟进日期'];
    const hasExecutor = Array.isArray(record['行动执行人']) && record['行动执行人'].length > 0;
    if ((action || date != null || hasExecutor) && (!action || typeof date !== 'number' || !Number.isFinite(date)))
      return '客户行动计划不完整，请补齐行动和日期';
    if (record['已归档'] === true) {
      const archived = record['归档时间'];
      if (typeof archived !== 'number' || !Number.isFinite(archived) || archived > now)
        return '归档时间缺失或晚于当前时间，请在原表核对';
      if (!textValue(record['归档原因']).trim()) return '归档原因缺失，请在原表补齐';
      const blocking = textValue(record['归档阻塞项目数']);
      if (blocking !== '0') return '归档阻塞项目尚未清零或计算结果未就绪，请先核对关联项目并刷新';
    }
  }
  return '';
}
