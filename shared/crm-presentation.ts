import type { CrmRecord } from './api.interface';
import { textValue } from './crm';
import { EVENT_PREFIX, lifecycleEvents, lifecycleTitles } from './crm-lifecycle';

/** Keep business history readable without exposing the machine event encoding. */
export function managementLogText(value: unknown): string {
  return textValue(value).split('\n').map(line => {
    if (!line.startsWith(EVENT_PREFIX)) return line.replace(/^(confirm-end|archive|restore|reopen) ·/,
      operation => `${lifecycleTitles[operation.split(' ')[0] as keyof typeof lifecycleTitles]} ·`);
    const event = lifecycleEvents({ 管理记录: line })[0];
    if (!event) return line;
    const previous = event.previous;
    const fields: [string, unknown][] = [
      ['终局状态', previous.terminal], ['归档状态', previous.archived ? '已归档' : '未归档'],
      ['结束日期', previous.endDate == null ? '' : displayDate('结束日期', previous.endDate)],
      ['归档时间', previous.archiveTime == null ? '' : displayDate('归档时间', previous.archiveTime)],
      ['行动', previous.action], ['计划日期', previous.dueDate == null ? '' : displayDate('下次跟进日期', previous.dueDate)],
      ['结果', previous.result], ['结束建议', previous.suggestion], ['建议说明', previous.suggestionNote],
      ['取消原因', previous.cancelReason], ['归档原因', previous.archiveReason],
    ];
    return `操作前信息\n${fields.filter(([, item]) => textValue(item)).map(([name, item]) => `  ${name}：${textValue(item)}`).join('\n')}`;
  }).join('\n');
}

const dateFields = new Set(['下次跟进日期', '目标完成日期', '结束日期', '预计成交日期', '建议日期']);
const timeFields = new Set(['最近整体互动', '最近直接跟进', '最近有效跟进', '最后目录同步']);
function scalar(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? scalar(value[0]) : null;
  if (value && typeof value === 'object' && 'value' in value) return scalar(value.value);
  return value;
}

/** Display only: always Shanghai time, never changes the stored timestamp. */
export function displayDate(name: string, value: unknown): string | null {
  const dateOnly = dateFields.has(name);
  if (!dateOnly && !name.endsWith('时间') && !timeFields.has(name)) return null;
  const ms = scalar(value);
  if (typeof ms !== 'number' || !Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(!dateOnly ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' as const } : {}),
  }).format(ms);
}

export function statusTone(name: string, value: string): string | null {
  if (!['工作状态', '通用状态', '客户关系状态', '联系人状态', '终局确认',
    '记录状态', '待配置角色', '目录状态', '处理请求'].includes(name)) return null;
  if (['正常', '有效', '已激活', '已完成', '合作中'].includes(value)) return 'green';
  if (['暂停', '暂停合作', '申请停用'].includes(value)) return 'amber';
  if (['进行中', '接洽中', '申请开通', '申请调整'].includes(value)) return 'blue';
  if (['已取消', '已作废'].includes(value)) return 'red';
  return 'neutral';
}

interface DetailGroup { title: string; collapsed: boolean; fields: [string, unknown][] }
const sections: [string, boolean, string[]][] = [
  ['基本资料', false, ['企业全称', '简称', '客户编号', '统一社会信用代码', '行业', '地区', '网站', '客户关系状态',
    '客户负责人', '客户备注', '姓名', '联系人编号', '部门', '职务', '所属企业', '电话', '邮箱', '客户侧业务角色',
    '技术领域', '维护人', '联系人状态', '备注', '项目名称', '项目编号', '项目类型', '项目负责人', '协同人员',
    '目标 / 需求摘要', '目标完成日期', '通用状态', '工作状态', '终局确认', '跟进主题', '跟进编号', '跟进归属',
    '直接客户', '关联项目', '有效客户名称', '实际发生时间', '实际跟进人', '记录类型', '记录状态',
    '飞书成员', '通讯录姓名', '目录状态', '待配置角色']],
  ['当前计划', false, ['当前下一步行动', '行动执行人', '有效执行人', '下次跟进日期']],
  ['推进与结果', false, ['当前进展', '暂停原因', '结束建议', '建议说明', '结束日期', '结果说明', '取消原因']],
  ['跟进内容', false, ['沟通 / 推进方式', '客户联系人', '内容 / 推进结论', '附件', '后续安排',
    '建议下一步行动', '建议处理人', '建议日期', '无后续动作结论']],
  ['商务信息', false, ['商机阶段', '预计金额', '币种', '金额含税口径', '预计成交日期', '成交结果']],
  ['关联与互动', false, ['联系人', '项目', '客户直接跟进', '项目跟进', '关联跟进', '相关业务项目', '已沟通联系人',
    '最近直接跟进', '最近整体互动', '最近有效跟进', '直接有效次数', '整体有效次数', '有效次数']],
  ['管理记录', true, ['数据检查', '身份检查', '已归档', '归档时间', '归档原因',
    '停用时间', '停用原因', '作废原因', '管理记录', '联系人管理记录', '最近重开原因']],
];

/** Every returned field stays accessible, including future fields not in our map. */
export function detailGroups(record: CrmRecord['record']): DetailGroup[] {
  const hidden = new Set(['核查标记', '核查说明', '跟进排序', '跟进状态', '今日到期', '逾期', '逾期天数', '缺计划']);
  const remaining = new Set(Object.keys(record).filter(key => !hidden.has(key)));
  const groups: DetailGroup[] = [];
  for (const [title, collapsed, keys] of sections) {
    const fields: [string, unknown][] = [];
    for (const key of keys) if (remaining.delete(key)) fields.push([key, record[key]]);
    if (fields.length) groups.push({ title, collapsed, fields });
  }
  if (remaining.size) groups.push({ title: '其他与系统信息', collapsed: true,
    fields: [...remaining].map((key) => [key, record[key]]) });
  return groups;
}
