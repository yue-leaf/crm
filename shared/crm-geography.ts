import type { CrmRecord, CustomerGeoData, CustomerGeoEntry } from './api.interface';
import { linkIds, textValue } from './crm';
import { parseCustomerRegion } from './crm-region';
import { followupTarget } from './crm-workflow';

export function customerGeography(source: {
  customer: CrmRecord[]; contact: CrmRecord[]; project: CrmRecord[]; followup: CrmRecord[];
}, now = Date.now()): CustomerGeoData {
  const customers = new Map<string, CustomerGeoEntry>(source.customer.map(row => {
    const originalRegion = textValue(row.record['地区']);
    const owners = row.record['客户负责人'];
    return [row.id, { id: row.id, name: textValue(row.record['企业全称']) || '未命名客户',
      ...parseCustomerRegion(originalRegion), originalRegion,
      owners: Array.isArray(owners) ? owners.map(String) : [], contacts: [], projectCount: 0, latestFollowup: null }];
  }));
  const projectCustomers = new Map<string, string>();
  for (const row of source.project) {
    const parents = linkIds(row.record['所属企业']);
    if (parents.length !== 1) continue;
    projectCustomers.set(row.id, parents[0]);
    const customer = customers.get(parents[0]);
    if (customer) customer.projectCount++;
  }
  for (const row of source.contact) {
    if (textValue(row.record['联系人状态']) !== '有效' || textValue(row.record['数据检查']).trim()) continue;
    const parents = linkIds(row.record['所属企业']);
    if (parents.length !== 1) continue;
    customers.get(parents[0])?.contacts.push({ id: row.id, name: textValue(row.record['姓名']) || '未命名联系人',
      phone: textValue(row.record['电话']), email: textValue(row.record['邮箱']) });
  }
  for (const row of source.followup) {
    const time = row.record['实际发生时间'];
    if (textValue(row.record['记录状态']) !== '正常' || textValue(row.record['数据检查']).trim() ||
      typeof time !== 'number' || !Number.isFinite(time) || time <= 0 || time > now) continue;
    const target = followupTarget(row);
    if (!target) continue;
    const customer = customers.get(target.kind === 'customer' ? target.id : projectCustomers.get(target.id) || '');
    if (customer && (!customer.latestFollowup || time > customer.latestFollowup.occurredAt ||
      (time === customer.latestFollowup.occurredAt && row.id < customer.latestFollowup.id))) {
      customer.latestFollowup = { id: row.id, occurredAt: time, conclusion: textValue(row.record['内容 / 推进结论']).slice(0, 240) };
    }
  }
  return { generatedAt: now, customers: [...customers.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id)) };
}

export function geographyMatches(row: CustomerGeoEntry, province: string, city: string, search: string): boolean {
  if (province === '__missing__' ? !!row.province : province && row.province !== province) return false;
  if (city === '__missing__' ? !!row.city : city && row.city !== city) return false;
  const query = search.trim().toLocaleLowerCase();
  return !query || [row.name, row.province, row.city, row.originalRegion].some(value => value.toLocaleLowerCase().includes(query));
}
