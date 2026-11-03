import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CrmRecord, EntityKind } from '@shared/api.interface';
import { linkIds } from '@shared/crm';
import { RecordDetails } from './RecordDetails';
import { CustomerContacts } from './CustomerContacts';
import { CustomerProjects } from './CustomerProjects';
import { FollowupFeed } from './FollowupFeed';
import type { FollowupView } from './FollowupFeed';
import { FollowupBadge } from './FollowupStatus';

interface Props {
  kind: 'customer' | 'project';
  row: CrmRecord;
  busy: boolean;
  tab: string;
  onTabChange: (tab: string) => void;
  onView: (row: CrmRecord, kind: EntityKind, customerId?: string) => void | Promise<void>;
  onEditContact: (row: CrmRecord) => void | Promise<void>;
  onCreate: (kind: 'contact' | 'project') => void;
  onContinue: (row: CrmRecord) => void | Promise<void>;
  onEnd: (row: CrmRecord) => void | Promise<void>;
  followupView: FollowupView;
  onFollowupViewChange: (view: FollowupView) => void;
}
export function CustomerWorkspace({ kind, row, busy, tab, onTabChange, onView, onEditContact, onCreate,
  followupView, onFollowupViewChange, onContinue, onEnd }: Props) {
  const parents: string[] = linkIds(row.record['所属企业']);
  const customerId: string | undefined = kind === 'customer' ? row.id : parents.length === 1 ? parents[0] : undefined;
  const blocked = false;
  const view = (record: CrmRecord, type: EntityKind) => onView(record, type, customerId);
  return <div className="crm-workspace">
    {kind === 'project' && <div className="workspace-followup-status"><span>跟进状态</span><FollowupBadge record={row.record} /></div>}
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList className="workspace-tabs" aria-label={kind === 'customer' ? '客户全览' : '项目全览'}>
        <TabsTrigger value="followups">跟进记录</TabsTrigger>
        <TabsTrigger value="contacts">{kind === 'project' ? '客户联系人' : '联系人'}</TabsTrigger>
        {kind === 'customer' && <TabsTrigger value="projects">关联项目</TabsTrigger>}
        <TabsTrigger value="details">资料详情</TabsTrigger>
      </TabsList>
      <TabsContent value="followups"><FollowupFeed kind={kind} id={row.id} busy={busy} onView={view}
        onContinue={onContinue} onEnd={onEnd} view={followupView} onViewChange={onFollowupViewChange} /></TabsContent>
      <TabsContent value="contacts">{customerId ? <CustomerContacts key={customerId} customerId={customerId}
        busy={busy} createBlocked={blocked} onView={(record: CrmRecord) => view(record, 'contact')}
        onEdit={onEditContact} onCreate={kind === 'customer' ? () => onCreate('contact') : undefined} />
        : <p className="panel-note" role="status">项目所属客户信息不完整，请先核对项目资料。</p>}</TabsContent>
      {kind === 'customer' && <TabsContent value="projects"><CustomerProjects customerId={row.id}
        busy={busy} createBlocked={blocked} onCreate={() => onCreate('project')}
        onView={(record: CrmRecord) => view(record, 'project')} /></TabsContent>}
      <TabsContent value="details"><RecordDetails record={row.record}
        onOpenRecord={(id, type) => onView({ id, record: {} }, type, customerId)}
        onOpenCustomer={(id: string) => onView({ id, record: {} }, 'customer', id)} /></TabsContent>
    </Tabs>
  </div>;
}
