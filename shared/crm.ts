import type { EntityKind } from './api.interface';
export type Draft = Record<string, string | string[] | number | boolean | null>;
export interface FieldSpec {
  key: string;
  label?: string;
  type:
    | 'text'
    | 'long'
    | 'select'
    | 'person'
    | 'relation'
    | 'date'
    | 'datetime'
    | 'attachment'
    | 'number';
  required?: boolean;
  multiple?: boolean;
  options?: string[];
  target?: EntityKind;
}
export const BASE_URL =
  'https://ecnkuk64l5wd.feishu.cn/base/CJLFbJHZ7al3zisi9e1cLAxjncd';
export const labels: Record<EntityKind, string> = {
  customer: '客户',
  contact: '联系人',
  project: '项目',
  followup: '跟进记录',
  access: '权限配置',
};
export const sectionLabels: Record<EntityKind, string> = {
  ...labels,
  customer: '客户管理',
  contact: '联系人管理',
  project: '项目管理',
};
export function crmSection(section: string | undefined): EntityKind | 'home' {
  return section && Object.prototype.hasOwnProperty.call(labels, section) ? section as EntityKind : 'home';
}
export const titles: Record<EntityKind, string> = {
  customer: '企业全称',
  contact: '姓名',
  project: '项目名称',
  followup: '跟进主题',
  access: '姓名',
};
export const forms: Record<EntityKind, FieldSpec[]> = {
  customer: [
    { key: '企业全称', type: 'text', required: true },
    {
      key: '行业',
      type: 'select',
      required: true,
      options: ['医药中间体', '大宗原料药', '特色原料药', '化学药品制剂', '化学创新药', 'CDMO/CMO', '其他化学制药'],
    },
    { key: '地区', type: 'text', required: true },
    { key: '客户负责人', type: 'person', required: true },
    { key: '客户备注', type: 'long' },
  ],
  contact: [
    { key: '所属企业', label: '所属客户', type: 'relation', required: true, target: 'customer' },
    { key: '姓名', type: 'text', required: true },
    { key: '职务', type: 'text', required: true },
    { key: '电话', type: 'text' },
    { key: '邮箱', type: 'text' },
    { key: '维护人', type: 'person', required: true },
  ],
  project: [
    { key: '项目名称', type: 'text', required: true },
    {
      key: '项目类型',
      type: 'select',
      required: true,
      options: ['MRT', 'PAT', 'automation'],
    },
    { key: '所属企业', type: 'relation', required: true, target: 'customer' },
    { key: '项目负责人', type: 'person', required: true },
    { key: '目标 / 需求摘要', type: 'long', required: true },
    { key: '当前下一步行动', type: 'long', required: true },
    { key: '下次跟进日期', type: 'date', required: true },
    { key: '目标完成日期', type: 'date' },
    { key: '预计金额', type: 'number' },
    { key: '币种', type: 'select', options: ['CNY', 'USD', 'EUR', '其他'] },
    {
      key: '金额含税口径',
      type: 'select',
      options: ['含税', '未税', '待确认'],
    },
  ],
  followup: [
    { key: '跟进主题', type: 'text', required: true },
    {
      key: '跟进归属',
      type: 'select',
      required: true,
      options: ['客户直接跟进', '项目跟进'],
    },
    { key: '直接客户', type: 'relation', target: 'customer' },
    { key: '关联项目', type: 'relation', target: 'project' },
    {
      key: '记录类型',
      type: 'select',
      required: true,
      options: ['外部沟通', '内部推进'],
    },
    {
      key: '沟通 / 推进方式',
      type: 'select',
      options: [
        '电话',
        '线上会议',
        '现场',
        '即时消息',
        '邮件',
        '内部讨论',
        '资料处理',
        '其他',
      ],
    },
    { key: '实际发生时间', type: 'datetime', required: true },
    { key: '实际跟进人', type: 'person', multiple: true, required: true },
    { key: '客户联系人', type: 'relation', multiple: true, target: 'contact' },
    { key: '内容 / 推进结论', type: 'long', required: true },
    {
      key: '后续安排',
      type: 'select',
      required: true,
      options: ['有下一步行动', '无后续动作'],
    },
    { key: '建议下一步行动', type: 'long' },
    { key: '建议处理人', type: 'person' },
    { key: '建议日期', type: 'date' },
    { key: '无后续动作结论', type: 'long' },
    { key: '附件', type: 'attachment', multiple: true },
  ],
  access: [
    {
      key: '待配置角色',
      label: '角色',
      type: 'select',
      required: true,
      options: ['员工', '管理员'],
    },
  ],
};
export const planFields: FieldSpec[] = [
  { key: '当前下一步行动', type: 'long', required: true },
  { key: '行动执行人', type: 'person' },
  { key: '下次跟进日期', type: 'date', required: true },
];
export const endFields: FieldSpec[] = [
  {
    key: '结束建议',
    type: 'select',
    required: true,
    options: ['申请完成', '申请取消'],
  },
  { key: '建议说明', type: 'long', required: true },
];
export function textValue(v: unknown): string {
  if (v == null) return '';
  // Base formula/lookup results wrap scalar values in arrays.
  if (Array.isArray(v)) return v.map(textValue).filter(Boolean).join('、');
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '');
  if (typeof v === 'object' && 'value' in v) return textValue(v.value);
  return '';
}
export function linkIds(v: unknown): string[] {
  if (
    v &&
    typeof v === 'object' &&
    'link_record_ids' in v &&
    Array.isArray(v.link_record_ids)
  )
    return v.link_record_ids.filter(
      (x: unknown): x is string => typeof x === 'string',
    );
  return [];
}
