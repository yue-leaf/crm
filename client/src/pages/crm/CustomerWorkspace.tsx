import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CrmRecord, EntityKind } from '@shared/api.interface';
import { linkIds, textValue } from '@shared/crm';
import { RecordDetails } from './RecordDetails';
import { CustomerContacts } from './CustomerContacts';
import { CustomerProjects } from './CustomerProjects';
import { FollowupFeed } from './FollowupFeed';
import { Cell } from './Fields';

interface Props {
  kind: 'customer' | 'project';
  row: CrmRecord;
  busy: boolean;
  tab: string;
  onTabChange: (tab: string) => void;
  onView: (row: CrmRecord, kind: EntityKind, customerId?: string) => void;
  onEditContact: (row: CrmRecord) => void;
  onCreate: (kind: 'contact' | 'project') => void;
}
export function CustomerWorkspace({ kind, row, busy, tab, onTabChange, onView, onEditContact, onCreate }: Props) {
  const parents: string[] = linkIds(row.record['所属企业']);
  const customerId: string | undefined = kind === 'customer' ? row.id : parents.length === 1 ? parents[0] : undefined;
  const blocked: boolean = row.record['已归档'] === true || textValue(row.record['核查标记']) !== '正常';
  const view = (record: CrmRecord, type: EntityKind) => onView(record, type, customerId);
  const action: string = textValue(row.record['当前下一步行动']);
  const inactive: boolean = row.record['已归档'] === true || ['已完成', '已取消'].includes(textValue(row.record['终局确认']));
  return <div className="crm-workspace">
    {!inactive && action && <div className="workspace-plan"><div><span>当前下一步</span><p>{action}</p></div>
      <div><Cell name="下次跟进日期" value={row.record['下次跟进日期']} /></div></div>}
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList className="workspace-tabs" aria-label={kind === 'customer' ? '客户全览' : '项目全览'}>
        <TabsTrigger value="followups">跟进记录</TabsTrigger>
        <TabsTrigger value="contacts">{kind === 'project' ? '客户联系人' : '联系人'}</TabsTrigger>
        {kind === 'customer' && <TabsTrigger value="projects">关联项目</TabsTrigger>}
        <TabsTrigger value="details">资料详情</TabsTrigger>
      </TabsList>
      <TabsContent value="followups"><FollowupFeed kind={kind} id={row.id} busy={busy} onView={view} /></TabsContent>
      <TabsContent value="contacts">{customerId ? <CustomerContacts key={customerId} customerId={customerId}
        busy={busy} createBlocked={blocked} onView={(record: CrmRecord) => view(record, 'contact')}
        onEdit={onEditContact} onCreate={kind === 'customer' ? () => onCreate('contact') : undefined} />
        : <p className="panel-note" role="status">项目所属客户信息不完整，请先核对项目资料。</p>}</TabsContent>
      {kind === 'customer' && <TabsContent value="projects"><CustomerProjects customerId={row.id}
        busy={busy} createBlocked={blocked} onCreate={() => onCreate('project')}
        onView={(record: CrmRecord) => view(record, 'project')} /></TabsContent>}
      <TabsContent value="details"><RecordDetails record={row.record}
        onOpenCustomer={(id: string) => onView({ id, record: {} }, 'customer', id)} /></TabsContent>
    </Tabs>
  </div>;
}
