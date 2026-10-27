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

const dateFields = new Set(['下次跟进日期', '目标完成日期', '签约日期', '结束日期', '预计成交日期', '建议日期']);
const timeFields = new Set(['最近整体互动', '最近直接跟进', '最近有效跟进', '最后目录同步']);
function scalar(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? scalar(value[0]) : null;
  if (value && typeof value === 'object' && 'value' in value) return scalar(value.value);
  return value;
}

export function numberValue(value: unknown): number | null {
  const raw = scalar(value);
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || !/^-?\d+(\.\d+)?$/.test(raw.trim())) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Formula booleans may arrive as strings or wrapped singleton arrays. */
export function displayBoolean(name: string, value: unknown): string | null {
  const raw = scalar(value);
  const text = textValue(raw).trim().toLowerCase();
  const known = ['已归档', '有效', '存在当前计划', '长期未跟进', '归档就绪', '归属正确'];
  if (typeof raw !== 'boolean' && (!known.includes(name) || !['true', 'false'].includes(text))) return null;
  const enabled = typeof raw === 'boolean' ? raw : text === 'true';
  if (name === '已归档') return enabled ? '已归档' : '未归档';
  if (name === '有效') return enabled ? '有效' : '无效';
  if (name === '存在当前计划') return enabled ? '已安排' : '未安排';
  if (name === '长期未跟进') return enabled ? '长期未跟进' : '跟进正常';
  return enabled ? '是' : '否';
}

export function detailFieldLabel(name: string): string {
  const labels: Record<string, string> = {
    非终局项目数: '在办项目', 未跟进天数: '未跟进时长', 已归档: '归档状态',
    修改人: '最近修改人', 修改时间: '最近修改时间', 待配置角色: '角色',
    直接有效次数: '客户直接跟进次数', 整体有效次数: '累计跟进次数', 有效次数: '项目跟进次数',
    所属企业: '所属客户',
    工作状态: '项目状态', 终局确认: '结束状态', 直接客户: '客户', 关联项目: '项目', 有效客户名称: '客户',
    实际发生时间: '跟进时间', 实际跟进人: '参与员工', '内容 / 推进结论': '跟进内容与结论',
    '沟通 / 推进方式': '沟通方式', 当前下一步行动: '下一步行动', 行动执行人: '执行人',
    建议下一步行动: '下一步建议', 建议处理人: '建议执行人', 建议日期: '建议跟进日期',
    无后续动作结论: '结束说明',
  };
  return labels[name] || name;
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
  if (!['工作状态', '通用状态', '联系人状态', '终局确认',
    '记录状态', '待配置角色', '目录状态', '处理请求'].includes(name)) return null;
  if (['正常', '有效', '已激活', '已签合同', '已完成', '合作中'].includes(value)) return 'green';
  if (['暂停', '暂停合作', '申请停用'].includes(value)) return 'amber';
  if (['进行中', '接洽中', '申请开通', '申请调整'].includes(value)) return 'blue';
  if (['已取消', '已作废'].includes(value)) return 'red';
  return 'neutral';
}

interface DetailGroup { title: string; collapsed: boolean; fields: [string, unknown][] }
function hasDetailValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return !!value.trim();
  if (Array.isArray(value)) return value.some(hasDetailValue);
  if (typeof value === 'object' && 'value' in value) return hasDetailValue(value.value);
  if (typeof value === 'object' && 'text' in value) return hasDetailValue(value.text);
  if (typeof value === 'object' && 'link_record_ids' in value) return hasDetailValue(value.link_record_ids);
  return true;
}
const sections: [string, boolean, string[]][] = [
  ['基本资料', false, ['企业全称', '简称', '客户编号', '统一社会信用代码', '行业', '地区', '网站',
    '客户负责人', '客户备注', '姓名', '联系人编号', '部门', '职务', '所属企业', '电话', '邮箱', '客户侧业务角色',
    '技术领域', '维护人', '联系人状态', '备注', '项目名称', '项目编号', '项目类型', '项目负责人', '协同人员',
    '目标 / 需求摘要', '目标完成日期', '签约日期', '通用状态', '工作状态', '跟进主题', '跟进编号',
    '直接客户', '关联项目', '有效客户名称', '实际发生时间', '实际跟进人', '记录类型', '记录状态',
    '飞书成员', '通讯录姓名', '目录状态', '待配置角色']],
  ['业务概况', false, ['非终局项目数', '未跟进天数']],
  ['当前计划', false, ['当前下一步行动', '行动执行人', '有效执行人', '下次跟进日期']],
  ['推进与结果', false, ['当前进展', '暂停原因', '结束建议', '建议说明', '结束日期', '结果说明', '取消原因']],
  ['跟进内容', false, ['沟通 / 推进方式', '客户联系人', '内容 / 推进结论', '附件', '后续安排',
    '建议下一步行动', '建议处理人', '建议日期', '无后续动作结论']],
  ['商务信息', false, ['商机阶段', '预计金额', '币种', '金额含税口径', '预计成交日期', '成交结果']],
  ['关联与互动', false, ['联系人', '项目', '客户直接跟进', '项目跟进', '关联跟进', '相关业务项目', '已沟通联系人',
    '最近直接跟进', '最近整体互动', '最近有效跟进', '直接有效次数', '整体有效次数', '有效次数']],
  ['管理记录', true, ['数据检查', '身份检查', '已归档', '归档时间', '归档原因',
    '停用时间', '停用原因', '作废原因', '管理记录', '联系人管理记录', '最近重开原因']],
  ['操作信息', true, ['创建人', '创建时间', '修改人', '修改时间']],
];

/** Only deliberately selected business fields are shown; new system fields stay hidden. */
export function detailGroups(record: CrmRecord['record']): DetailGroup[] {
  const groups: DetailGroup[] = [];
  for (const [title, collapsed, keys] of sections) {
    const fields: [string, unknown][] = [];
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      if (key === '结束日期' && textValue(record['终局确认']) === '未确认') continue;
      if (key === '有效客户名称' && record['直接客户'] && hasDetailValue(record['直接客户'])) continue;
      const value = record[key];
      if (!hasDetailValue(value)) continue;
      fields.push([key, value]);
    }
    if (fields.length) groups.push({ title, collapsed, fields });
  }
  return groups;
}
