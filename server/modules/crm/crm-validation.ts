import { BadRequestException } from '@nestjs/common';
import type { FieldSpec, Draft } from '@shared/crm';

export function reject(field: string, message: string): never {
  throw new BadRequestException(`${field}：${message}`);
}
export function dateMillis(
  value: unknown,
  field: string,
  time = false,
): number {
  if (typeof value !== 'string') return reject(field, '请选择日期');
  const pattern = time
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
    : /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(value)) return reject(field, '日期格式无效');
  const d = value.slice(0, 10);
  const day = Date.parse(d + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== d)
    return reject(field, '日期不存在');
  const ms = Date.parse(time ? value + '+08:00' : d + 'T00:00:00+08:00');
  if (
    !Number.isFinite(ms) ||
    (time &&
      (Number(value.slice(11, 13)) > 23 ||
        Number(value.slice(14, 16)) > 59 ||
        Number(value.slice(17, 19) || 0) > 59))
  )
    return reject(field, '时间不存在');
  return ms;
}
export function parseDraft(
  input: unknown,
  spec: FieldSpec[],
  enums: Record<string, string[]>,
): { draft: Draft; fields: Record<string, unknown> } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return reject('表单', '格式无效');
  const source = input as Record<string, unknown>;
  const allowed = new Set(spec.map((f) => f.key));
  for (const k of Object.keys(source))
    if (!allowed.has(k)) reject(k, '此操作不可修改该字段');
  const draft: Draft = {};
  const fields: Record<string, unknown> = {};
  for (const f of spec) {
    const v = source[f.key];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
      if (f.required) reject(f.key, '此项必填');
      draft[f.key] = null;
      continue;
    }
    if (f.type === 'person' || f.type === 'relation') {
      if (
        !Array.isArray(v) ||
        !v.length ||
        (!f.multiple && v.length !== 1) ||
        v.length > 100 ||
        v.some(
          (x) =>
            typeof x !== 'string' ||
            !(f.type === 'person' ? /^[1-9]\d*$/ : /^rec[A-Za-z0-9]+$/).test(x),
        ) ||
        new Set(v).size !== v.length
      )
        reject(f.key, '选择项无效或重复');
      const ids = v as string[];
      draft[f.key] = ids;
      if (f.type === 'person') {
        const n = ids.map(Number);
        if (n.some((x) => !Number.isSafeInteger(x)))
          reject(f.key, '人员标识超出插件安全范围');
        fields[f.key] = n;
      } else fields[f.key] = ids;
    } else if (f.type === 'date' || f.type === 'datetime') {
      fields[f.key] = dateMillis(v, f.key, f.type === 'datetime');
      draft[f.key] = String(v);
    } else if (f.type === 'number') {
      if (
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > Number.MAX_SAFE_INTEGER / 100 ||
        Math.abs(v * 100 - Math.round(v * 100)) > 1e-6
      )
        reject(f.key, '请输入非负金额，最多两位小数');
      draft[f.key] = v;
      fields[f.key] = v;
    } else {
      if (
        typeof v !== 'string' ||
        !v.trim() ||
        v.length > (f.type === 'long' ? 20000 : 2000)
      )
        reject(f.key, '请输入有效内容');
      const s = v.trim();
      if (f.type === 'select' && !(enums[f.key] || f.options || []).includes(s))
        reject(f.key, '选项无效，请刷新页面');
      fields[f.key] = s;
      draft[f.key] = s;
    }
  }
  return { draft, fields };
}
