import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Compare semantic values without depending on JSON object key order.
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

async function readUntil(read, matches, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const result = read();
    if (matches(result) || Date.now() - start >= timeoutMs) return result;
    await delay(1000);
  }
}
export async function reconcileView(base, args, plan, columns, fields) {
  const names = Object.fromEntries(fields.map(f => [f.id, f.name]));
  const ids = Object.fromEntries(fields.map(f => [f.name, f.id]));
  const fieldId = name => { if (!ids[name]) throw new Error('Missing view field: ' + name); return ids[name]; };
  const desired = {
    filter: { logic: 'and', conditions: plan.conditions },
    visible: plan.columns || columns,
    sort: plan.sorts || (plan.sort ? [{ field: plan.sort, desc: !!plan.desc }] : []),
    group: plan.group ? [{ field: plan.group, desc: false }] : [],
  };
  const normalize = (key, value) => {
    if (key === 'filter') return { logic: value?.logic || 'and', conditions: (value?.conditions || []).map(([f,operator,...rest]) => [names[f] || f,operator,...(['empty','non_empty'].includes(operator) ? [] : rest.map(v => Array.isArray(v) ? v.map(item => item && typeof item === 'object' && 'id' in item ? {id:item.id} : item) : v))]) };
    if (key === 'visible') return value.map(f => names[f] || f);
    return (value || []).map(v => ({ field: names[v.field] || v.field, desc: !!v.desc }));
  };
  const spec = {
    filter: ['filter', 'filter', { logic: 'and', conditions: plan.conditions.map(([f,...rest]) => [fieldId(f),...rest]) }],
    visible: ['visible-fields', 'visible_fields', { visible_fields: desired.visible.map(fieldId) }],
    sort: ['sort', 'sort', { sort_config: desired.sort.map(v => ({ ...v, field: fieldId(v.field) })) }],
    group: ['group', 'group', { group_config: desired.group.map(v => ({ ...v, field: fieldId(v.field) })) }],
  };
  const before = {}, after = {}, changed = [];
  for (const [key, [suffix, resultKey, body]] of Object.entries(spec)) {
    before[key] = base('+view-get-' + suffix, args);
    let actual = normalize(key, before[key].data[resultKey]);
    if (!equal(actual, desired[key])) {
      base('+view-set-' + suffix, args, body);
      after[key] = await readUntil(() => base('+view-get-' + suffix, args), result => equal(normalize(key, result.data[resultKey]), desired[key]));
      actual = normalize(key, after[key].data[resultKey]);
      changed.push(key);
    } else after[key] = before[key];
    assert.deepEqual(stable(actual), stable(desired[key]), 'View readback mismatch: ' + plan.name + '/' + key);
  }
  return { before, after, changed };
}

// The API returns text/formula filter scalars as arrays and adds display defaults.
function dashboardValue(value, key) {
  // Text get serializes rich-text blocks without paragraph separators.
  if (key === 'text') return value?.replace(/[\r\n]/g, '');
  if (key === 'group_by') return (value || []).map(v => ({...v,sort:{type:v.sort?.type || 'group',order:v.sort?.order || 'asc'}}));
  if (key === 'filter') return {
    conjunction: value?.conjunction || 'and',
    conditions: (value?.conditions || []).map(c => ({ ...c, ...('value' in c && !Array.isArray(c.value) && typeof c.value !== 'boolean' ? { value: [c.value] } : {}) })),
  };
  return value;
}
export function dashboardMatches(actual, desired) {
  return Object.entries(desired).every(([key, value]) => equal(dashboardValue(actual?.[key], key), dashboardValue(value, key)));
}
export async function reconcileBlock(base, args, desired, before) {
  if (before.type !== desired.type) throw new Error(`Block type changed for ${desired.name}; explicit migration required, no automatic deletion.`);
  // Top-level API merges cannot silently remove semantic keys or switch metric modes.
  for (const key of ['series', 'count_all', 'filter', 'group_by']) {
    if (key in (before.data_config || {}) && !(key in desired.config) &&
        !(key === 'filter' && !(before.data_config.filter?.conditions?.length)) &&
        !(key === 'group_by' && !(before.data_config.group_by?.length))) {
      throw new Error(`Removing dashboard key ${key} from ${desired.name} requires an explicit migration.`);
    }
  }
  const changed = before.name !== desired.name || !dashboardMatches(before.data_config, desired.config);
  if (changed) base('+dashboard-block-update', [...args, '--name', desired.name, '--data-config', JSON.stringify(desired.config)]);
  const response = await readUntil(() => base('+dashboard-block-get', args), result => {
    const b = result.data.block || result.data;
    return b.name === desired.name && dashboardMatches(b.data_config, desired.config);
  });
  const after = response.data.block || response.data;
  assert.equal(after.name, desired.name);
  assert.equal(after.type, desired.type);
  assert.ok(dashboardMatches(after.data_config, desired.config), 'Dashboard readback mismatch: ' + desired.name);
  return { before, after, changed };
}
