import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CrmRecord, DeleteKind, DeletionPreview } from '@shared/api.interface';
import { linkIds, textValue, titles } from '@shared/crm';
import { followupChains, sameFollowupTarget } from '@shared/crm-followup-chain';

export type DataKind = 'customer' | 'project' | 'contact' | 'followup';
export type DeletionSource = Record<DataKind, CrmRecord[]>;
export interface DeletionPlan {
  kind: DeleteKind; rootId: string; name: string; summary: string;
  items: { kind: DataKind; id: string }[];
  repairs: { id: string; before: string[]; after: string[] }[];
  acknowledgements?: { id: string; childId: string }[];
  signature: string; restoresPending: number;
}
export const itemKey = (item: {kind: DataKind; id: string}): string => `${item.kind}:${item.id}`;
export function deletionPlan(source: DeletionSource, kind: DeleteKind, id: string): DeletionPlan {
  const root = source[kind].find(row => row.id === id);
  if (!root) throw new NotFoundException('记录已不存在，请刷新列表');
  const projects = new Set(kind === 'customer' ? source.project.filter(row => linkIds(row.record['所属企业']).includes(id)).map(row => row.id) : kind === 'project' ? [id] : []);
  const contacts = new Set(kind === 'customer' ? source.contact.filter(row => linkIds(row.record['所属企业']).includes(id)).map(row => row.id) : []);
  const followups = new Set(source.followup.filter(row => kind === 'followup' ? row.id === id :
    linkIds(row.record['关联项目']).some(pid => projects.has(pid)) || (kind === 'customer' && linkIds(row.record['直接客户']).includes(id))).map(row => row.id));
  if (kind==='customer' && [...source.project.filter(row=>projects.has(row.id)),...source.contact.filter(row=>contacts.has(row.id))]
    .some(row=>linkIds(row.record['所属企业']).length!==1)) throw new ConflictException('关联记录同时属于多个客户，请先核对所属客户');
  if (kind!=='followup' && source.followup.filter(row=>followups.has(row.id)).some(row=>
    linkIds(row.record['关联项目']).some(pid=>!projects.has(pid)) || linkIds(row.record['直接客户']).some(cid=>kind!=='customer'||cid!==id)))
    throw new ConflictException('跟进同时关联了其他客户或项目，请先核对归属');
  // Do not silently damage a contact used by an unrelated customer/project.
  if (source.followup.some(row => !followups.has(row.id) && linkIds(row.record['客户联系人']).some(cid => contacts.has(cid))))
    throw new ConflictException('有其他客户或项目的跟进引用了这些联系人，请先核对关联关系');
  const items: DeletionPlan['items'] = [
    ...[...followups].sort().map(recordId => ({kind: 'followup' as const, id: recordId})),
    ...[...contacts].sort().map(recordId => ({kind: 'contact' as const, id: recordId})),
    ...[...projects].sort().map(recordId => ({kind: 'project' as const, id: recordId})),
    ...(kind === 'customer' ? [{kind, id}] : []),
  ];
  const repairs: DeletionPlan['repairs'] = [];
  for (const row of source.followup.filter(row => !followups.has(row.id))) {
    const before = linkIds(row.record['上次跟进']);
    if (!before.some(previous => followups.has(previous))) continue;
    let after: string[] = [];
    if (kind === 'followup') {
      const parentIds = linkIds(root.record['上次跟进']);
      const parent = source.followup.find(item => parentIds.length === 1 && item.id === parentIds[0]);
      if (parent && parent.id !== row.id && sameFollowupTarget(parent, row) && sameFollowupTarget(root, row)) after = [parent.id];
    }
    repairs.push({id: row.id, before, after});
  }
  // Keep proof of completed communication before removing its child record.
  const acknowledgements = followupChains(source.followup)
    .filter(row => !followups.has(row.id))
    .flatMap(row => (row.followup?.nextIds || []).filter(childId => followups.has(childId))
      .map(childId => ({ id: row.id, childId })));
  const restoresPending = 0;
  const signature = createHash('sha256').update(JSON.stringify({
    items: items.map(item => {const record=source[item.kind].find(row=>row.id===item.id)!.record;
      return [itemKey(item),record['修改时间'],textValue(record[titles[item.kind]])];}), repairs, acknowledgements,
    boundary: source.followup.filter(row=>repairs.some(repair=>repair.id===row.id||repair.after.includes(row.id))||linkIds(root.record['上次跟进']).includes(row.id))
      .map(row=>[row.id,row.record['修改时间']]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  })).digest('hex');
  return {kind, rootId:id, items, repairs, acknowledgements, signature, restoresPending,
    name: textValue(root.record[titles[kind]]) || '未命名记录',
    summary: kind === 'followup' ? [
      ...source.customer.filter(row => linkIds(root.record['直接客户']).includes(row.id) || source.project.some(p => linkIds(root.record['关联项目']).includes(p.id) && linkIds(p.record['所属企业']).includes(row.id))).map(row => textValue(row.record['企业全称'])),
      ...source.project.filter(row => linkIds(root.record['关联项目']).includes(row.id)).map(row => textValue(row.record['项目名称'])),
      typeof root.record['实际发生时间'] === 'number' ? new Date(root.record['实际发生时间']).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false}) : '',
      textValue(root.record['内容 / 推进结论']).slice(0,160),
    ].filter(Boolean).join(' · ') : '',
  };
}
export function deletionView(id: string, plan: DeletionPlan, status: DeletionPreview['status'], deleted = 0, message = ''): DeletionPreview {
  const counts = {customer:0, project:0, contact:0, followup:0};
  for (const item of plan.items) counts[item.kind]++;
  return {id, kind:plan.kind, name:plan.name, summary:plan.summary, counts, restoresPending:0, status, deleted, total:plan.items.length, message};
}
