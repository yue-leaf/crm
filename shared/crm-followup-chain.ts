import type { CrmRecord, FollowupChain } from './api.interface';
import { linkIds, textValue } from './crm';
import { followupTarget } from './crm-workflow';
import { shanghaiDay } from './crm-followup-status';

export const validChainTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isFinite(new Date(v).getTime());
export function explicitlyEnded(record: CrmRecord['record']): boolean {
  // The audit line also recognizes explicit endings saved before this distinction was introduced.
  return textValue(record['后续处理']) === '已结束' &&
    /^结束跟进 · \d{4}-\d{2}-\d{2}T[^\n]+/m.test(textValue(record['管理记录']));
}
export function sameFollowupTarget(a: CrmRecord, b: CrmRecord): boolean {
  const first = followupTarget(a), second = followupTarget(b);
  return !!first && !!second && first.kind === second.kind && first.id === second.id;
}
/** The child relation is the acknowledgement. Creating a continuation needs only one Base write. */
export function followupChains(rows: CrmRecord[], now = Date.now()): CrmRecord[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const ids = linkIds(row.record['上次跟进']);
    const parent = ids.length === 1 ? byId.get(ids[0]) : undefined;
    if (!parent || parent.id === row.id || textValue(row.record['记录状态']) !== '正常' || !sameFollowupTarget(parent, row)) continue;
    const time = row.record['实际发生时间'], previous = parent.record['实际发生时间'];
    if (!validChainTime(time) || !validChainTime(previous) || time < previous || time > now) continue;
    children.set(parent.id, [...(children.get(parent.id) || []), row.id]);
  }
  return rows.map(row => {
    const r = row.record, nextIds = children.get(row.id) || [];
    let state: FollowupChain['state'];
    if (textValue(r['记录状态']) === '已作废') state = '已作废';
    else if (textValue(r['记录状态']) !== '正常') state = '待核对';
    else if (nextIds.length) state = '已跟进';
    else if (textValue(r['后续处理']) === '已结束') state = '已结束';
    else if (!textValue(r['后续处理'])) state = '历史记录';
    else if (textValue(r['后续处理']) !== '待跟进' || textValue(r['数据检查']).trim() ||
      !validChainTime(r['实际发生时间']) || r['实际发生时间'] > now || !followupTarget(row)) state = '待核对';
    else state = textValue(r['后续安排']) === '有下一步行动' ? '待跟进' : '已结束';
    return { ...row, followup: { state, previousId: linkIds(r['上次跟进'])[0], nextIds } };
  });
}

export function projectFollowupSummary(projects: CrmRecord[], followups: CrmRecord[], now = Date.now()): CrmRecord[] {
  const pending = followupChains(followups, now).filter(row => row.followup?.state === '待跟进');
  return projects.map(project => {
    const rows = pending.filter(row => linkIds(row.record['关联项目']).includes(project.id));
    const dates = rows.map(row => row.record['建议日期']).filter(validChainTime);
    return { ...project, record: { ...project.record,
      今日跟进数量: dates.filter(due => shanghaiDay(due) === shanghaiDay(now)).length,
      明日跟进数量: dates.filter(due => shanghaiDay(due) === shanghaiDay(now) + 1).length,
      等待跟进数量: dates.filter(due => shanghaiDay(due) > shanghaiDay(now) + 1).length,
      待跟进数量: rows.length, 逾期跟进数量: dates.filter(due => shanghaiDay(due) < shanghaiDay(now)).length,
      待跟进执行人: [...new Set(rows.flatMap(row => Array.isArray(row.record['建议处理人']) ? row.record['建议处理人'].map(String) : []))],
      待安排数量: rows.length - dates.length, 最近待跟进日期: dates.length ? Math.min(...dates) : null,
    } };
  });
}
