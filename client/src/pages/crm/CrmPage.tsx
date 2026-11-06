import { PreviousFollowup } from './PreviousFollowup';
import { DeleteDialog, PendingDeletions } from './DeleteDialog';
import type { DeleteKind, DeletionPreview } from '@shared/api.interface';
import { FollowupChainPanel } from './FollowupChainPanel';
import { explicitlyEnded } from '@shared/crm-followup-chain';
import { CustomerContactDrafts } from './CustomerContactDrafts';
import { saveCustomerContacts, loadCustomerContactDrafts, contactDraftChanged, type PendingContact, type CustomerSaveProgress } from '@shared/crm-customer-create';
import { defaultEmployeeSelection } from '@shared/crm-people';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Users,
  FolderKanban,
  MessageSquareText,
  LayoutDashboard,
  ShieldCheck,
  ArrowUpRight,
  Plus,
  RefreshCw,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Eye,
  ArrowLeft,
  Bell,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import { ActionButton as Button } from './ActionButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, SaveOutcomeUnknown } from '@/api/crm';
import type {
  CrmPage as PageData,
  CrmRecord,
  CrmSession,
  ProjectScope,
  ProjectFilter,
  EntityKind,
} from '@shared/api.interface';
import {
  BASE_URL,
  forms,
  projectCreateFields,
  labels,
  titles,
  textValue,
  crmSection,
  sectionLabels,
  linkIds,
} from '@shared/crm';
import type { WorkspaceData } from '@shared/crm-workspace';
import { advancementBlocked } from '@shared/crm-workflow';
import type { Draft, FieldSpec } from '@shared/crm';
import {
  editFields,
  recordDraft,
  changedFields,
  editBlockedReason,
} from '@shared/crm-edit';
import { Cell, FieldInput, message } from './Fields';
import { RelationField } from './RelationField';
import { RecordDetails } from './RecordDetails';
import { DetailToolbar } from './DetailToolbar';
import { CustomerWorkspace } from './CustomerWorkspace';
import './customer-workspace.css';
import {
  followupTarget, relatedDraft,
} from '@shared/crm-workflow';
import { recordReviewProblem } from '@shared/crm-review';
import { appendPage, changeDraft, missingFields, requiredField } from '@shared/crm-interaction';
import { crmAdmin } from '@shared/crm-access';

import { ProjectDashboard } from './ProjectDashboard';
import { FollowupDueDate, useFollowupClock } from './FollowupStatus';
import { followupFilterLabels, validFollowupFilter, shanghaiDay } from '@shared/crm-followup-status';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FollowupFilter } from '@shared/api.interface';
import { projectFacts, validProjectFilter } from '@shared/crm-dashboard';
import { detailFieldLabel } from '@shared/crm-presentation';
import { projectFilterLabels } from '@shared/crm-dashboard';
import { changeFilter, changeFollowupListTarget } from '@shared/crm-ux';
import { defaultFollowupView, type FollowupView } from './FollowupFeed';
import { RelatedPageMemory } from './RelatedPageMemory';
import type { RelatedPosition } from '@shared/crm-navigation';
import { NotificationSettings } from './NotificationSettings';
import { restoreDetailScroll } from './restoreDetailScroll';
import {
  FOLLOWUP_CUSTOMER, followupCreateFields, changeFollowupTarget, followupWriteDraft, projectFirstDraft, validateContinuationDraft,
} from '@shared/crm-followup-target';
import './crm.css';

const icons = {
  customer: Building2,
  contact: Users,
  project: FolderKanban,
  followup: MessageSquareText,
  access: ShieldCheck,
};
const columns: Record<EntityKind, string[]> = {
  customer: [
    '企业全称',
    '行业',
    '客户负责人',
  ],
  contact: ['姓名', '所属企业', '职务', '电话', '邮箱', '联系人状态'],
  project: [
    '所属企业',
    '项目类型',
    '项目名称',
    '工作状态',
    '待办情况',
    '最近待跟进日期',
  ],
  followup: [
    '有效客户名称',
    '关联项目',
    '实际发生时间',
    '建议日期',
    '实际跟进人',
    '记录类型',
    '后续状态',
  ],
  access: ['姓名', '部门', '待配置角色'],
};
const columnLabel = (name: string): string => name === '建议日期' ? '下次跟进时间' : detailFieldLabel(name);
interface Editor {
  firstFollowup?: Draft;
  savedProjectId?: string;
  previousFollowupId?: string;
  fixedCustomerId?: string;
  fixedProjectId?: string;
  kind: EntityKind;
  operation: 'create' | 'edit' | 'access' | 'end-followup' | 'resume-followup';
  row?: CrmRecord;
}
interface DetailLocation { row: CrmRecord; kind: EntityKind; tab: string; customer: string | null; scroll: number }
interface SuspendedEditor { editor: Editor; draft: Draft; initial: Draft; origin: DetailLocation | null }
const rawSpecs = (editor: Editor): FieldSpec[] =>
  ['end-followup', 'resume-followup'].includes(editor.operation)
    ? editor.operation === 'end-followup' ? [{ key: '结束跟进说明', label: '结束说明', type: 'long' }] : []
    : editor.operation === 'edit'
    ? editFields(editor.kind)
    : editor.kind === 'followup' ? followupCreateFields
      : editor.kind === 'project' ? projectCreateFields : forms[editor.kind];
const specs = (editor: Editor): FieldSpec[] => rawSpecs(editor)
  .map((field: FieldSpec) => ({ ...field, label: field.label || detailFieldLabel(field.key) }));
function visibleFollowupField(f: FieldSpec, draft: Draft) {
  if (f.key === '直接客户') return draft['跟进归属'] === '客户直接跟进';
  if (f.key === '客户联系人') return draft['记录类型'] === '外部沟通';
  if (['建议下一步行动', '建议处理人', '建议日期'].includes(f.key)) return draft['后续安排'] === '有下一步行动';
  if (f.key === '无后续动作结论') return draft['后续安排'] === '无后续动作';
  return true;
}
function firstFields(draft: Draft) {
  return specs({ kind: 'followup', operation: 'create' })
    .filter(f => ![FOLLOWUP_CUSTOMER, '关联项目', '上次跟进'].includes(f.key) && visibleFollowupField(f, draft))
    .map(f => requiredField(f, 'followup', 'create', draft));
}
const CrmPage: React.FC = () => {
  const [deleteTarget,setDeleteTarget] = useState<{kind:DeleteKind;id:string}|{job:DeletionPreview}|null>(null);
  const [deleteRevision,setDeleteRevision] = useState(0);
  const navigate = useNavigate();
  const { section } = useParams();
  const [params] = useSearchParams();
  const scope: ProjectScope = params.get('scope') === 'mine' ? 'mine' : 'all';
  const rawFilter = params.get('projectFilter') || 'all';
  const projectFilter: ProjectFilter = validProjectFilter(rawFilter) ? rawFilter : 'all';
  const active = crmSection(section);
  const now = useFollowupClock();
  const currentDay = shanghaiDay(now);
  const rawFollowupFilter = params.get('followupFilter') || 'all';
  const followupFilter: FollowupFilter = validFollowupFilter(rawFollowupFilter) ? rawFollowupFilter : 'all';
  const listCustomerId = active === 'followup' || active === 'project' ? params.get('customerId') || '' : '';
  const listProjectId = active === 'followup' ? params.get('projectId') || '' : '';
  const profile = useCurrentUserProfile();
  const [session, setSession] = useState<CrmSession | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const openedDeepLink = useRef('');
  const [overview, setOverview] = useState<WorkspaceData | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<CrmRecord | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [selectionKind, setSelectionKind] = useState<EntityKind>('customer');
  const [detailTrail, setDetailTrail] = useState<DetailLocation[]>([]);
  const [followupViews, setFollowupViews] = useState<Record<string, FollowupView>>({});
  const relatedMemory = useRef(new Map<string, RelatedPosition>());
  const [scrollRequest, setScrollRequest] = useState<{ key: string; tab: string; top: number } | null>(null);
  const editorOrigin = useRef<DetailLocation | null>(null);
  const suspendedEditor = useRef<SuspendedEditor | null>(null);
  const [followupCustomer, setFollowupCustomer] = useState('');
  const [projectResolving, setProjectResolving] = useState(false);
  const projectResolution = useRef(0);
  const projectResolvingRef = useRef(false);
  const [customerResolveError, setCustomerResolveError] = useState('');
  const [customerResolveRetry, setCustomerResolveRetry] = useState(0);
  const [customerContext, setCustomerContext] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('followups');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [pendingContacts, setPendingContacts] = useState<PendingContact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const customerSave = useRef<CustomerSaveProgress>({ contacts: {} });
  const [saveError, setSaveError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const onUploadBusy = useCallback((busy: boolean) => { uploadingRef.current = busy; setUploading(busy); }, []);
  const [uncertain, setUncertain] = useState(false);
  const savingRef = useRef(false);
  const detailVersion = useRef(0);
  const editorRequestVersion = useRef(0);
  const initialDraft = useRef<Draft>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [removeFirstOpen, setRemoveFirstOpen] = useState(false);
  const firstInitial = useRef<Draft>({});
  const requestVersion = useRef(0);
  const admin = !!session && crmAdmin(session.roles);
  const authorized = !!session && (active !== 'access' || admin);
  const draftCustomer = Array.isArray(draft[FOLLOWUP_CUSTOMER]) ? draft[FOLLOWUP_CUSTOMER][0] || '' : '';
  useEffect(() => {
    let canceled = false;
    setFollowupCustomer(''); setCustomerResolveError('');
    if (editor?.kind !== 'followup') return;
    if (editor.operation === 'create') { setFollowupCustomer(draftCustomer); return; }
    const direct = linkIds(editor.row?.record['直接客户'])[0];
    const project = linkIds(editor.row?.record['关联项目'])[0];
    if (direct) { setFollowupCustomer(direct); return; }
    if (project) void api.get('project', project).then((row: CrmRecord) => {
      if (canceled) return;
      const customers: string[] = linkIds(row.record['所属企业']);
      if (customers.length === 1) setFollowupCustomer(customers[0]);
      else setCustomerResolveError('项目所属客户信息不完整，请先核对项目资料');
    }).catch((e: unknown) => { if (!canceled) setCustomerResolveError(message(e)); });
    else setCustomerResolveError('这条跟进缺少所属客户或项目，请先核对跟进资料');
    return () => { canceled = true; };
  }, [editor, draftCustomer, customerResolveRetry]);
  const currentLocation = (): DetailLocation | null => selection ? {
    row: selection, kind: selectionKind, tab: detailTab, customer: customerContext,
    scroll: document.querySelector('.crm-detail-dialog .crm-dialog-body')?.scrollTop || 0,
  } : null;
  const restoreLocation = (location: DetailLocation, row: CrmRecord = location.row) => {
    setSelection(row); setSelectionKind(location.kind); setDetailTab(location.tab); setCustomerContext(location.customer);
    setScrollRequest({ key: `${location.kind}:${row.id}`, tab: location.tab, top: location.scroll });
  };
  useEffect(() => {
    if (!scrollRequest || scrollRequest.key !== `${selectionKind}:${selection?.id}` || scrollRequest.tab !== detailTab) return;
    let stop: (() => void) | undefined;
    let frame: number;
    let attempts: number = 0;
    const attach = () => {
      const body = document.querySelector<HTMLElement>('.crm-detail-dialog .crm-dialog-body');
      if (body) stop = restoreDetailScroll(body, scrollRequest.top);
      else if (++attempts < 60) frame = requestAnimationFrame(attach);
    };
    frame = requestAnimationFrame(attach);
    return () => { cancelAnimationFrame(frame); stop?.(); };
  }, [scrollRequest, selection?.id, selectionKind, detailTab]);
  useEffect(() => {
    let canceled = false;
    api
      .session()
      .then((s) => {
        if (!canceled) setSession(s);
      })
      .catch((e) => {
        if (!canceled) setError(message(e));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);
  const reload = useCallback(async (keepRows = 0) => {
    if (!authorized) return;
    const version = ++requestVersion.current;

    setLoading(true);
    setError('');
    try {
      if (active === 'home') {
        const next = await api.workspace(scope);
        if (version === requestVersion.current) setOverview(next);
      } else {
        const filters = active === 'project' ? { scope, projectFilter, followupFilter, customerId: listCustomerId }
          : active === 'followup' ? { customerId: listCustomerId, projectId: listProjectId } : undefined;
        let next = await api.list(active, '', query, filters);
        const cursors = new Set<string>();
        while (next.records.length < keepRows && next.hasMore && next.pageToken && version === requestVersion.current) {
          if (cursors.has(next.pageToken)) throw new Error('分页数据重复，请刷新重试');
          cursors.add(next.pageToken);
          next = appendPage(next, await api.list(active, next.pageToken, query, filters));
        }
        if (version === requestVersion.current) setData(next);
      }
    } catch (e: unknown) {
      if (version === requestVersion.current) setError(message(e));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [active, authorized, query, scope, projectFilter, followupFilter, listCustomerId, listProjectId]);
  useEffect(() => {
    setData(null);
    setOverview(null);
    setSelection(null);
    void reload();
    return () => {
      requestVersion.current++;
    };
  }, [reload]);
  const lastRefreshDay = useRef(currentDay);
  useEffect(() => {
    if (lastRefreshDay.current === currentDay) return;
    lastRefreshDay.current = currentDay;
    void reload();
  }, [currentDay, reload]);
  const changePage = (key: EntityKind | 'home') => {
    requestVersion.current++;
    setSearch('');
    setQuery('');
    setDetailTrail([]);
    navigate(key === 'home' ? '/' : `/crm/${key}`);
  };
  const updateFilter = (key: string, value: string) => {
    requestVersion.current++;
    // Read the latest URL so consecutive changes cannot overwrite a pending router render.
    const next = changeFilter(new URLSearchParams(window.location.search), key, value);
    navigate(`${active === 'home' ? '/' : '/crm/' + active}?${next}`);
  };
  const updateFollowupTargetFilter = (key: 'customerId' | 'projectId' | 'reset', value = '') => {
    requestVersion.current++;
    const next = changeFollowupListTarget(new URLSearchParams(window.location.search), key, value);
    navigate(`/crm/followup?${next}`);
  };
  const openEditor = (
    kind: EntityKind,
    operation: Editor['operation'] = 'create',
    row?: CrmRecord,
    preset: Draft = {},
    contacts: PendingContact[] = [],
  ) => {
    if (savingRef.current || uploadingRef.current) return;
    if (kind === 'customer' && ['create', 'edit'].includes(operation)) {
      setPendingContacts(contacts); setSelectedContacts(contacts.map(c => c.key)); customerSave.current = { contacts: {} };
    }
    projectResolution.current++; projectResolvingRef.current = false; setProjectResolving(false);
    editorOrigin.current = currentLocation();
    setFollowupCustomer(''); setCustomerResolveError('');
    editorRequestVersion.current++;
    detailVersion.current++;
    const customer = preset[kind === 'followup' ? FOLLOWUP_CUSTOMER : '所属企业'];
    const fixedCustomerId = ['contact', 'project', 'followup'].includes(kind) && operation === 'create' &&
      Array.isArray(customer) && customer.length === 1 ? customer[0] : undefined;
    const projects = preset['关联项目'];
    const fixedProjectId = kind === 'followup' && operation === 'create' &&
      Array.isArray(projects) && projects.length === 1 ? projects[0] : undefined;
    const ed: Editor = { kind, operation, row, fixedCustomerId, fixedProjectId,
      previousFollowupId: Array.isArray(preset['上次跟进']) ? preset['上次跟进'][0] : undefined };
    const initial: Draft =
      row ? recordDraft(row.record, specs(ed)) : {};
    if (operation === 'create')
      for (const f of specs(ed)) {
        if (f.type === 'person' && f.required)
          initial[f.key] = defaultEmployeeSelection(session);
        if (f.type === 'select' && f.required && !['行业', '项目类型'].includes(f.key))
          initial[f.key] = f.options?.[0] || '';
      }
    if (kind === 'followup' && operation === 'create') {
      initial['实际发生时间'] = new Date(Date.now() + 8 * 3600000)
        .toISOString()
        .slice(0, 16);
      initial['后续安排'] = '有下一步行动';
    }
    Object.assign(initial, preset);
    initialDraft.current = structuredClone(initial);
    setDraft(initial);
    setSaveError('');
    setFieldErrors({});
    setUncertain(false);
    setEditor(ed);
  };
  const edit = async (row: CrmRecord, kind = active, operation: 'edit' | 'end-followup' | 'resume-followup' = 'edit') => {
    if (kind === 'home' || kind === 'access' || savingRef.current || uploadingRef.current) return;
    detailVersion.current++;
    const version = requestVersion.current;
    const editorRequest = ++editorRequestVersion.current;

    try {
      const fresh = await api.get(kind, row.id);
      if (version !== requestVersion.current || editorRequest !== editorRequestVersion.current) return;
      const blocked = editBlockedReason(kind, fresh);
      if (blocked) {
        toast.error(blocked);
        return;
      }
      const contacts = kind === 'customer' && operation === 'edit' ? await loadCustomerContactDrafts(fresh.id, api.customerContacts) : [];
      if (version !== requestVersion.current || editorRequest !== editorRequestVersion.current) return;
      openEditor(kind, operation, fresh, {}, contacts);
    } catch (e: unknown) {
      if (version === requestVersion.current && editorRequest === editorRequestVersion.current) toast.error(message(e));
    }
  };
  const detail = async (row: CrmRecord, kind = active, contextCustomerId?: string, initialTab: 'followups' | 'contacts' | 'projects' = 'followups', prefetched = false) => {
    if (kind === 'home' || savingRef.current || uploadingRef.current) return;
    editorRequestVersion.current++;
    const version = requestVersion.current;
    const detailRequest = ++detailVersion.current;
    try {
      const next = prefetched ? row : await api.get(kind, row.id);
      if (version === requestVersion.current && detailRequest === detailVersion.current) {
        const previous = currentLocation();
        if (previous && (previous.row.id !== next.id || previous.kind !== kind)) setDetailTrail((trail) => [...trail, previous]);
        if (!previous) setDetailTrail([]);
        setScrollRequest(null);
        setSelectionKind(kind);
        setDetailTab(initialTab);
        const parents: string[] = linkIds(next.record[kind === 'followup' ? '直接客户' : '所属企业']);
        setCustomerContext(kind === 'customer' ? next.id : contextCustomerId || (parents.length === 1 ? parents[0] : null));
        setSelection(next);
      }
    } catch (e: unknown) {
      if (version === requestVersion.current && detailRequest === detailVersion.current) toast.error(message(e));
    }
  };
  const recordLink = params.get('record') || '';
  useEffect(() => {
    const key = `${active}:${recordLink}`;
    if (!recordLink) { openedDeepLink.current = ''; return; }
    if (!authorized || loading || (active !== 'customer' && active !== 'project' && active !== 'followup') || openedDeepLink.current === key) return;
    openedDeepLink.current = key;
    if (/^rec[A-Za-z0-9]+$/.test(recordLink)) void detail({ id: recordLink, record: {} }, active);
    // Open once when the linked page finishes its initial load; closing stays closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, recordLink, authorized, loading]);
  const workspaceAction = async (kind: 'customer' | 'project', id: string) => {
    if (savingRef.current || uploadingRef.current) return;
    detailVersion.current++;
    const version = requestVersion.current;
    const editorRequest = ++editorRequestVersion.current;

    try {
      const row = await api.get(kind, id);
      if (version !== requestVersion.current || editorRequest !== editorRequestVersion.current) return;
      const blocked = advancementBlocked(kind, row);
      if (blocked) { toast.error(blocked); return; }
      openEditor('followup', 'create', undefined, relatedDraft(kind, row, 'followup'));
    } catch (e: unknown) {
      if (version === requestVersion.current && editorRequest === editorRequestVersion.current) toast.error(message(e));
    }
  };
  const resumeFollowup = (contactId?: string) => {
    const suspended = suspendedEditor.current;
    if (!suspended) return false;
    suspendedEditor.current = null;
    setEditor(suspended.editor); initialDraft.current = suspended.initial; editorOrigin.current = suspended.origin;
    setDraft(contactId ? { ...suspended.draft, 客户联系人: [...new Set([
      ...(Array.isArray(suspended.draft['客户联系人']) ? suspended.draft['客户联系人'] : []), contactId,
    ])] } : suspended.draft);
    setSaveError(''); setFieldErrors({}); setUncertain(false);
    return true;
  };
  const newContactDuringFollowup = () => {
    if (!editor || !followupCustomer || savingRef.current || uploadingRef.current) return;
    const suspended: SuspendedEditor = { editor, draft: structuredClone(draft), initial: initialDraft.current, origin: editorOrigin.current };
    openEditor('contact', 'create', undefined, { 所属企业: [followupCustomer] });
    suspendedEditor.current = suspended;
  };
  const closeEditor = () => {
    if (savingRef.current || uploadingRef.current) return;
    projectResolution.current++; projectResolvingRef.current = false; setProjectResolving(false);
    if (!uncertain && editor && (
      editor.firstFollowup ||
      Object.keys(changedFields(initialDraft.current, draft, specs(editor))).length ||
      (editor.kind === 'customer' && ['create', 'edit'].includes(editor.operation) && pendingContacts.some(contactDraftChanged))
    )) {
      setDiscardOpen(true);
      return;
    }
    if (uncertain && suspendedEditor.current) toast.info('联系人保存结果待确认，请先搜索刚才填写的姓名，避免重复新增。');
    if (resumeFollowup()) return;
    setEditor(null);
    if (uncertain) {
      if (editorOrigin.current) {
        restoreLocation(editorOrigin.current);
        setDetailRevision((previous) => previous + 1);
      } else setSelection(null);
      void reload();
    }
  };
  const save = async () => {
    if (!editor || savingRef.current || uploadingRef.current || projectResolvingRef.current || uncertain) return;
    const errors = missingFields(specs(editor).filter(showField).map((field) => requiredField(field, editor.kind, editor.operation, draft)), draft);
    if (editor.firstFollowup) Object.assign(errors, missingFields(firstFields(editor.firstFollowup), editor.firstFollowup));
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setSaveError('请检查标记的字段后再保存');
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('.crm-editor-form [data-invalid="true"]');
        first?.scrollIntoView({ block: 'center' });
        first?.querySelector<HTMLElement>('input, textarea, button, [role="combobox"]')?.focus();
      });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    let savedProjectId = editor.savedProjectId;
    try {
      if (editor.kind === 'followup' && editor.operation === 'create' && editor.previousFollowupId)
        validateContinuationDraft(draft, editor.previousFollowupId, editor.fixedCustomerId, editor.fixedProjectId);
      const createProjectWithFollowup = async (first: Draft) => {
        if (!savedProjectId) {
          const project = await api.create('project', editor.fixedCustomerId ? { ...draft, 所属企业: [editor.fixedCustomerId] } : draft);
          savedProjectId = project.id;
          setEditor({ ...editor, savedProjectId });
          if (project.warning) toast.warning(project.warning);
        }
        const followup = await api.create('followup', followupWriteDraft({ ...first, 关联项目: [savedProjectId] }));
        return { ...followup, message: '项目及首次跟进已保存' };
      };
      const r = editor.firstFollowup ? await createProjectWithFollowup(editor.firstFollowup)
        : editor.kind === 'customer' && ['create', 'edit'].includes(editor.operation)
        ? await saveCustomerContacts(draft, pendingContacts, selectedContacts, customerSave.current, api.create,
          editor.operation === 'edit' && editor.row ? { row: editor.row, edit: api.edit } : undefined)
        : editor.operation === 'edit' && editor.row
          ? await api.edit(editor.kind, editor.row.id, {
              changes: changedFields(
                recordDraft(editor.row.record, specs(editor)),
                draft,
                editor.kind === 'project' ? specs(editor).filter(showField) : specs(editor),
              ),
              expectedModifiedAt: Number(editor.row.record['修改时间']),
            })
          : editor.row
            ? await api.update(
                editor.kind,
                editor.row.id,
                editor.operation,
                draft,
                Number(editor.row.record['修改时间']),
              )
            : await api.create(editor.kind, editor.kind === 'followup' ? followupWriteDraft(editor.fixedCustomerId
              ? { ...draft, [FOLLOWUP_CUSTOMER]: [editor.fixedCustomerId],
                ...(editor.fixedProjectId ? { 关联项目: [editor.fixedProjectId] } : {}) }
              : editor.fixedProjectId ? { ...draft, 关联项目: [editor.fixedProjectId] } : draft)
              : editor.fixedCustomerId ? { ...draft, 所属企业: [editor.fixedCustomerId] } : draft);
      if (r.warning) toast.warning(r.warning);
      else toast.success(r.message);
      if (suspendedEditor.current) { resumeFollowup(r.id); return; }
      const origin = editorOrigin.current;
      if (origin) {
        restoreLocation(origin);
        setDetailRevision((previous) => previous + 1);
      } else setSelection(null);
      setEditor(null);
      const refresh = reload(data?.records.length || 0);
      const version = requestVersion.current;
      const detailRequest = ++detailVersion.current;
      await refresh;
      if (version !== requestVersion.current || !origin) return;
      try {
        const parent = await api.get(origin.kind, origin.row.id);
        if (version === requestVersion.current && detailRequest === detailVersion.current) {
          restoreLocation(origin, parent);
        }
      } catch {
        if (version === requestVersion.current && detailRequest === detailVersion.current)
          toast.info('保存已完成，详情暂未刷新，请稍后重新打开核对');
      }
    } catch (e: unknown) {
      if (e instanceof SaveOutcomeUnknown) setUncertain(true);
      setSaveError(savedProjectId ? (e instanceof SaveOutcomeUnknown ? '项目已创建，首次跟进保存结果待核对。' : '项目已创建，首次跟进未保存。') + message(e)
        : editor.kind === 'customer' && ['create', 'edit'].includes(editor.operation) && customerSave.current.customer
        ? `客户已保存，部分联系人未完成。${message(e)}${e instanceof SaveOutcomeUnknown ? '' : '；可再次保存以继续未完成的联系人。'}`
        : message(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const continueFollowup = async (record: CrmRecord) => {
    if (savingRef.current || uploadingRef.current) return;
    detailVersion.current++;
    const version = requestVersion.current;
    const request = ++editorRequestVersion.current;
    try {
      const row = await api.get('followup', record.id);
      if (request !== editorRequestVersion.current || version !== requestVersion.current) return;
      if (row.followup?.state !== '待跟进') { toast.info('此记录已处理，请刷新查看'); return; }
      const target = followupTarget(row);
      if (!target) throw new Error('跟进所属客户或项目不完整');
      const parent = await api.get(target.kind, target.id);
      if (request !== editorRequestVersion.current || version !== requestVersion.current) return;
      openEditor('followup', 'create', undefined, { ...relatedDraft(target.kind, parent, 'followup'), 上次跟进: [row.id] });
    } catch (e: unknown) {
      if (request === editorRequestVersion.current && version === requestVersion.current) toast.error(message(e));
    }
  };
  const set = (key: string, value: Draft[string]) => {
    if (editor?.previousFollowupId && ['上次跟进', '关联项目', FOLLOWUP_CUSTOMER].includes(key)) return;
    if (editor?.fixedProjectId && key === '关联项目') return;
    if (editor?.fixedCustomerId && (key === '所属企业' || key === FOLLOWUP_CUSTOMER)) return;
    if (savingRef.current || (uploadingRef.current && key !== '附件')) return;
    if (editor?.savedProjectId) return;
    if (key === '所属企业' && editor?.firstFollowup && JSON.stringify(draft[key]) !== JSON.stringify(value))
      setEditor({ ...editor, firstFollowup: { ...editor.firstFollowup, 客户联系人: [] } });
    if (key === FOLLOWUP_CUSTOMER || key === '关联项目') {
      const request = ++projectResolution.current;
      projectResolvingRef.current = false; setProjectResolving(false);
      if (editor?.kind === 'followup' && editor.operation === 'create' && key === '关联项目' &&
        !(Array.isArray(draft[FOLLOWUP_CUSTOMER]) && draft[FOLLOWUP_CUSTOMER].length) && Array.isArray(value) && value.length === 1) {
        projectResolvingRef.current = true; setProjectResolving(true); setSaveError('');
        void api.get('project', value[0]).then(row => {
          if (request !== projectResolution.current) return;
          // Validate before entering a React updater so errors stay in this promise chain.
          const resolved = projectFirstDraft({}, row);
          setDraft(previous => ({ ...previous, ...resolved }));
          setFieldErrors(previous => { const next = { ...previous }; delete next[FOLLOWUP_CUSTOMER]; delete next['关联项目']; delete next['客户联系人']; return next; });
        }).catch((error: unknown) => {
          if (request === projectResolution.current) setSaveError(message(error));
        }).finally(() => {
          if (request === projectResolution.current) { projectResolvingRef.current = false; setProjectResolving(false); }
        });
        return;
      }
    }
    setFieldErrors((previous) => {
      const next = { ...previous }; delete next[key];
      if (key === FOLLOWUP_CUSTOMER) { delete next['关联项目']; delete next['客户联系人']; }
      if (key === '关联项目') delete next['客户联系人'];
      if (key === '电话' || key === '邮箱') { delete next['电话']; delete next['邮箱']; }
      return next;
    });
    setDraft((previous) => editor?.kind === 'followup' && editor.operation === 'create' &&
      [FOLLOWUP_CUSTOMER, '关联项目'].includes(key) && Array.isArray(value)
      ? changeFollowupTarget(previous, key, value)
      : changeDraft(previous, key, value, initialDraft.current, editor?.operation === 'edit'));
  };
  const showField = (f: FieldSpec) => {
    if (editor?.kind === 'project' && editor.operation === 'edit') {
      const state = draft['项目状态'];
      if (f.key === '暂停原因') return state === '暂停';
      if (f.key === '签约日期') return state === '已签合同';
      if (['结束日期', '取消原因'].includes(f.key)) return state === '已取消';
    }
    if (editor?.kind === 'contact' && f.key === '停用原因') return draft['联系人状态'] === '停用';
    if (
      editor?.kind === 'project' &&
      ['预计金额', '币种', '金额含税口径'].includes(f.key)
    )
      return draft['项目类型'] === '销售机会';
    if (editor?.kind === 'followup') return visibleFollowupField(f, draft);
    return true;
  };
  return (
    <RelatedPageMemory.Provider value={relatedMemory.current}><div className="crm-shell">
      <aside className="crm-sidebar">
        <div className="brand">
          <span>
            <Building2 size={23} />
          </span>
          <div>
            客户与项目<b>协作管理</b>
          </div>
        </div>
        <div className="nav-caption">协作空间</div>
        <nav>
          <Button
            variant="ghost"
            className={active === 'home' ? 'selected' : ''}
            onClick={() => changePage('home')}
          >
            <LayoutDashboard size={18} />
            工作台
          </Button>
          {(Object.keys(labels) as EntityKind[]).filter(key => key !== 'contact' && (key !== 'access' || admin)).map((key) => {
            const Icon = icons[key];
            return (
              <Button
                key={key}
                variant="ghost"
                className={active === key ? 'selected' : ''}
                onClick={() => changePage(key)}
              >
                <Icon size={18} />
                {sectionLabels[key]}
              </Button>
            );
          })}
          {admin && <Button variant="ghost" onClick={() => setNotificationOpen(true)}><Bell size={18} />通知设置</Button>}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={16} /> 企业数据 · 飞书连接
          <p>让每一次协作，都有下一步。</p>
        </div>
      </aside>
      <div className="crm-main">
        <header className="crm-topbar">
          <span>
            客户与项目协作 <ChevronRight size={14} />{' '}
            {active === 'home' ? '工作台' : sectionLabels[active]}
          </span>
          <div>
            飞书工作空间
            <span className="current-person">
              {profile.name || session?.name || '登录中'}
            </span>
          </div>
        </header>
        {notificationOpen && admin && <NotificationSettings onClose={() => setNotificationOpen(false)} />}
        <main className="crm-content">
          {admin&&<PendingDeletions revision={deleteRevision} onResume={job=>setDeleteTarget({job})} />}
          {!authorized ? (
            <section className="empty-panel">
              <ShieldCheck size={36} />
              <h1>{loading ? '正在核验登录身份' : active === 'access' ? '仅管理员可管理配置' : '请登录企业账号'}</h1>
              <p>
                {error || (active === 'access' && !admin ? '权限配置仅限管理员管理。' : '请使用本企业飞书账号登录后继续。')}
              </p>
              <p>本企业成员可直接使用业务功能，无需单独分配员工角色。</p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={16} />
                重新核验
              </Button>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {active === 'home' ? '工作台' : sectionLabels[active]}
                  </h1>
                </div>
                <div className="heading-actions">
                  {(active === 'home' || active === 'project') && <Select value={scope} onValueChange={(value: string) => updateFilter('scope', value)}>
                    <SelectTrigger className="project-scope" aria-label={active === 'home' ? '工作台范围' : '项目范围'}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">{active === 'home' ? '全部' : '全部项目'}</SelectItem><SelectItem value="mine">{active === 'home' ? '与我相关' : '我负责的'}</SelectItem></SelectContent>
                  </Select>}
                  <Button
                    variant="outline"
                    onClick={() => void reload()}
                    disabled={loading}
                  >
                    <RefreshCw size={16} className={loading ? 'spin' : ''} />
                    刷新
                  </Button>
                  {active !== 'access' && (
                    <Button
                      onClick={() =>
                        openEditor(active === 'home' ? 'followup' : active)
                      }
                    >
                      <Plus size={16} />
                      {active === 'home' ? '记录跟进' : `新建${labels[active]}`}
                    </Button>
                  )}
                </div>
              </div>
              {error && active !== 'home' && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              {active === 'home' ? (
                <ProjectDashboard data={overview} loading={loading} error={error} busy={saving || uploading}
                  onRetry={() => void reload()} onOpen={(row, kind) => detail(row, kind)}
                  onOpenLoaded={(row, kind) => detail(row, kind, undefined, 'followups', true)}
                  onAction={workspaceAction}
                  onContinue={continueFollowup} onEnd={row => edit(row, 'followup', 'end-followup')}
                  onCreate={() => openEditor('followup', 'create')} />
              ) : (
                <section className="panel list-panel">
                  <form
                    className="list-toolbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = search.trim();
                      if (next === query) void reload(); else setQuery(next);
                    }}
                  >
                    {active === 'project' && <div className="toolbar-relation"><span>所属客户</span><RelationField
                      field={{ key: '筛选客户', label: '所属客户', type: 'relation', target: 'customer' }}
                      value={listCustomerId ? [listCustomerId] : []}
                      onChange={(ids) => updateFilter('customerId', ids[0] || 'all')} /></div>}
                    {active === 'followup' && <>
                      <div className="toolbar-relation"><span>客户</span><RelationField
                        field={{ key: '筛选客户', label: '客户', type: 'relation', target: 'customer' }}
                        value={listCustomerId ? [listCustomerId] : []}
                        onChange={(ids) => updateFollowupTargetFilter('customerId', ids[0] || '')} /></div>
                      <div className="toolbar-relation"><span>项目</span><RelationField key={listCustomerId}
                        field={{ key: '筛选项目', label: '项目', type: 'relation', target: 'project' }}
                        customerId={listCustomerId || undefined} value={listProjectId ? [listProjectId] : []}
                        onChange={(ids) => updateFollowupTargetFilter('projectId', ids[0] || '')} /></div>
                    </>}
                    <div className="toolbar-search">
                      <Label htmlFor="crm-list-search">{active === 'customer' ? '企业名称' : detailFieldLabel(titles[active])}</Label>
                      <Input
                        id="crm-list-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`请输入${active === 'customer' ? '企业名称' : detailFieldLabel(titles[active])}`}
                      />
                    </div>
                    {active === 'project' && <div className="followup-filter"><span>跟进状态</span>
                      <Select value={followupFilter} onValueChange={(value: string) => {
                        updateFilter('followupFilter', value);
                      }}><SelectTrigger aria-label="筛选跟进状态"><SelectValue>{followupFilter === 'all' ? '全部' : followupFilterLabels[followupFilter]}</SelectValue></SelectTrigger>
                        <SelectContent>{Object.entries(followupFilterLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
                      </Select></div>}
                    <Button type="submit" variant="outline">
                      搜索
                    </Button>
                    {(search || query || listCustomerId || listProjectId) && <Button type="button" variant={active === 'followup' ? 'secondary' : 'ghost'} onClick={() => {
                      setSearch(''); setQuery('');
                      if (active === 'followup' && (listCustomerId || listProjectId)) updateFollowupTargetFilter('reset');
                      else if (active === 'project' && listCustomerId) updateFilter('customerId', 'all');
                      else if (!query) void reload();
                    }}>{active === 'followup' ? '重置' : '清空搜索'}</Button>}
                    {active === 'project' && projectFilter !== 'all' && <Button type="button" size="sm" variant="secondary"
                      aria-label={`清除${projectFilterLabels[projectFilter]}筛选`}
                      onClick={() => updateFilter('projectFilter', 'all')}>{projectFilterLabels[projectFilter]} ×</Button>}
                    {active === 'project' && scope === 'mine' && <Button type="button" size="sm" variant="secondary"
                      aria-label="清除我负责的筛选" onClick={() => updateFilter('scope', 'all')}>我负责的 ×</Button>}
                    <span className="toolbar-count" role="status" aria-live="polite">
                      {loading
                        ? '加载中…'
                        : `已加载 ${data?.records.length ?? 0} 条`}
                    </span>
                  </form>
                  <div className="table-scroll">
                    <table role="table" aria-label={sectionLabels[active]}>
                      <thead role="rowgroup">
                        <tr role="row">
                          {columns[active].map((c) => (
                            <th role="columnheader" key={c}>{columnLabel(c)}</th>
                          ))}
                          <th role="columnheader">操作</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {data?.records.map((row) => (
                          <tr role="row" key={row.id}>
                            {columns[active].map((c) => (
                              <td role="cell" data-label={columnLabel(c)} key={c}>
                                {c === titles[active] ? (
                                  <button
                                    className={active === 'followup' ? 'record-title workspace-clamp' : 'record-title'}
                                    title={textValue(row.record[c])}
                                    disabled={saving || uploading}
                                    onClick={() => detail(row)}
                                  >
                                    {textValue(row.record[c]) || '未命名'}
                                  </button>
                                ) : active === 'project' && c === '工作状态' ? (
                                  <Cell name="工作状态" value={projectFacts(row, Date.now()).state || '状态异常'} />
                                 ) : c === '待办情况' ? <button className="record-title" onClick={() => { setFollowupViews(previous => ({ ...previous, [`project:${row.id}`]: { ...defaultFollowupView, status: 'pending' } })); return detail(row, 'project'); }}>{Number(row.record['待跟进数量'])
                                  ? `待跟进 ${row.record['待跟进数量']}${Number(row.record['逾期跟进数量']) ? ` · 逾期 ${row.record['逾期跟进数量']}` : ''}` : '暂无待跟进'}</button>
                                  : active === 'followup' && c === '建议日期' ? <FollowupDueDate row={row} now={now} />
                                  : c === '后续状态' ? <span className={`tag ${row.followup?.state === '待跟进' ? 'blue' : 'neutral'}`}>{row.followup?.state || '—'}</span> : (
                                  <Cell name={c} value={row.record[c]} onOpenCustomer={id => detail({ id, record: {} }, 'customer', undefined, active === 'contact' ? 'contacts' : 'followups')}
                                    onOpenRecord={(id, kind) => detail({ id, record: {} }, kind)} />
                                )}
                              </td>
                            ))}
                            <td role="cell" data-label="操作" className="record-actions">
                              <div className="record-action-list">
                              {active === 'followup' && row.followup?.state === '待跟进' && <Button size="sm" variant="ghost" disabled={saving || uploading} onClick={() => continueFollowup(row)}>继续跟进</Button>}
                              {active === 'customer' && <Button variant="ghost" size="sm" disabled={saving || uploading} onClick={() => detail(row, 'customer', undefined, 'contacts')}><Users size={14} />联系人</Button>}
                              {active !== 'customer' && <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                disabled={saving || uploading}
                                onClick={() =>
                                  active === 'access'
                                    ? openEditor(active, 'access', row)
                                    : detail(row)
                                }
                              >
                                {active === 'access' ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                                {active === 'access' ? '编辑' : '查看'}
                              </Button>}
                              {active === 'contact' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={
                                    saving || uploading ||
                                    !!editBlockedReason(active, row)
                                  }
                                  title={
                                    editBlockedReason(active, row) || '编辑资料'
                                  }
                                  onClick={() => edit(row)}
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                  编辑
                                </Button>
                              )}
                              {admin && (active==='customer'||active==='project'||active==='followup') && <Button
                                variant="ghost" size="sm" className="crm-delete-button gap-1.5" disabled={saving||uploading}
                                onClick={()=>setDeleteTarget({kind:active,id:row.id})}><Trash2 size={14} aria-hidden="true" />删除</Button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {loading && !data?.records.length && <div className="empty-table" role="status"><LoaderCircle size={18} className="spin" />正在读取记录…</div>}
                  {!loading && !data?.records.length && !error && (
                    <div className="empty-table">
                      {active === 'project' ? '没有符合当前范围与筛选条件的项目，可清除筛选或新建项目。' : query ? '没有找到匹配记录，请更换关键词或清空搜索。' : active === 'access' ? '尚无成员记录，请先在飞书同步通讯录。' : '还没有记录，点击右上角新建开始填写。'}
                    </div>
                  )}
                  <div className="list-footer" hidden={!data?.hasMore}>
                    {data?.hasMore && (
                      <Button
                        variant="outline"
                        disabled={loading}
                        onClick={async () => {
                          if (!data.pageToken) { setError('分页信息缺失，请刷新后重试'); return; }
                          const version = ++requestVersion.current;
                          setLoading(true);
                          setError('');
                          try {
                            const next = await api.list(
                              active,
                              data.pageToken,
                              query,
                              active === 'project' ? { scope, projectFilter, followupFilter, customerId: listCustomerId }
                                : active === 'followup' ? { customerId: listCustomerId, projectId: listProjectId } : undefined,
                            );
                            if (version === requestVersion.current)
                              setData((previous) => appendPage(previous, next));
                          } catch (e: unknown) {
                            if (version === requestVersion.current)
                              setError(message(e));
                          } finally {
                            if (version === requestVersion.current)
                              setLoading(false);
                          }
                        }}
                      >
                        {loading ? '正在加载…' : '加载更多'}
                        <ChevronRight size={15} />
                      </Button>
                    )}
                  </div>
                </section>
              )}
              <footer className="page-footer">
                <a href={BASE_URL} target="_blank" rel="noreferrer">
                  打开飞书原表
                  <ArrowUpRight size={14} />
                </a>
              </footer>
            </>
          )}
        </main>
      </div>
      <Dialog
        open={!!selection && !editor}
        onOpenChange={(open) => {
          if (!open && !editor && !savingRef.current && !uploadingRef.current) {
            editorRequestVersion.current++;
            detailVersion.current++;

            setSelection(null);
            setDetailTrail([]);
          }
        }}
      >
        <DialogContent className="crm-dialog crm-detail-dialog" aria-describedby={undefined}>
          <header className="crm-dialog-header">
          {detailTrail.length > 0 ? <Button type="button" variant="ghost" size="sm" disabled={saving || uploading}
            onClick={async () => {
              const previous = detailTrail[detailTrail.length - 1];
              editorRequestVersion.current++;
              const version = ++detailVersion.current;
              try {
                const fresh = await api.get(previous.kind, previous.row.id);
                if (version !== detailVersion.current) return;
                setDetailTrail((trail) => trail.slice(0, -1)); restoreLocation(previous, fresh);
              } catch (e: unknown) { if (version === detailVersion.current) toast.error(message(e)); }
            }}><ArrowLeft size={14} />返回{detailTrail[detailTrail.length - 1].kind === 'followup' ? '跟进记录' : textValue(detailTrail[detailTrail.length - 1].row.record[titles[detailTrail[detailTrail.length - 1].kind]]) || '上一页'}</Button>
          : customerContext && selectionKind !== 'customer' && <Button type="button" variant="ghost" size="sm"
            className="detail-customer-back" disabled={saving || uploading}
            onClick={() => detail({ id: customerContext, record: {} }, 'customer', undefined, selectionKind === 'contact' ? 'contacts' : selectionKind === 'project' ? 'projects' : 'followups')}>
            <ArrowLeft size={14} />返回客户全览</Button>}
          <DialogTitle>
            {selection
              ? selectionKind === 'followup' ? '跟进记录' : textValue(selection.record[titles[selectionKind]])
              : '记录详情'}
          </DialogTitle>
          </header>
          <div className="crm-dialog-body">
          {selection && (
            <>
              {selectionKind === 'followup' && <FollowupChainPanel row={selection} busy={saving || uploading}
                onContinue={() => continueFollowup(selection)}
                onEnd={() => edit(selection, 'followup', 'end-followup')}
                onResume={() => edit(selection, 'followup', 'resume-followup')}
                onOpen={id => detail({ id, record: {} }, 'followup')} />}
              <DetailToolbar key={`toolbar:${selectionKind}:${selection.id}`} kind={selectionKind} row={selection} busy={saving || uploading}
                onEdit={() => edit(selection, selectionKind)}
                onFollowup={() => openEditor('followup', 'create', undefined, relatedDraft(
                  selectionKind as 'customer' | 'project', selection, 'followup'))}
                onTarget={() => { const target = followupTarget(selection); if (target) return detail(
                  { id: target.id, record: {} }, target.kind, customerContext || undefined); }} />
              {selectionKind !== 'access' && recordReviewProblem(selectionKind, selection.record) && (
                <p className="panel-note" role="status">{recordReviewProblem(selectionKind, selection.record)}</p>
              )}
              {selectionKind === 'project' && textValue(selection.record['结束建议']) && (
                <p className="panel-note">已有结束建议，可在“更多操作”中确认完成或取消。</p>
              )}
              {selectionKind === 'customer' || selectionKind === 'project'
                ? <CustomerWorkspace key={`workspace:${selectionKind}:${selection.id}:${detailRevision}`} kind={selectionKind} row={selection}
                    followupView={followupViews[`${selectionKind}:${selection.id}`] || defaultFollowupView}
                    onFollowupViewChange={(view) => setFollowupViews((previous) => ({ ...previous,
                      [`${selectionKind}:${selection.id}`]: view }))}
                    tab={detailTab} onTabChange={(tab) => { setScrollRequest(null); setDetailTab(tab); }}
                    busy={saving || uploading}
                    onView={(row: CrmRecord, kind: EntityKind, customerId?: string) => detail(row, kind, customerId)}
                    onContinue={continueFollowup} onEnd={row => edit(row, 'followup', 'end-followup')}
                    onEditContact={(row: CrmRecord) => edit(row, 'contact')}
                    onCreate={(kind: 'contact' | 'project') => openEditor(kind, 'create', undefined,
                      relatedDraft('customer', selection, kind))} />
                : <RecordDetails key={`details:${selectionKind}:${selection.id}`} record={selection.record}
                    onOpenRecord={(id, kind) => detail({ id, record: {} }, kind, customerContext || undefined)}
                    onOpenCustomer={(id: string) => detail({ id, record: {} }, 'customer', undefined, selectionKind === 'contact' ? 'contacts' : 'followups')} />}

            </>
          )}
          </div>
          <div className="form-actions">
            <Button variant="outline" onClick={() => { editorRequestVersion.current++; detailVersion.current++; setSelection(null); setDetailTrail([]); }}>关闭详情</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="crm-dialog">
          <header className="crm-dialog-header">
          <DialogTitle>
            {editor
              ? editor.operation === 'end-followup' ? '结束跟进'
                : editor.operation === 'resume-followup' ? '恢复跟进'
                : editor.operation === 'create'
                ? `新建${labels[editor.kind]}`
                : editor.operation === 'edit'
                  ? `编辑${labels[editor.kind]}`
                  : '编辑权限配置'
              : ''}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editor?.operation === 'create'
              ? '填写信息后保存。'
              : editor?.operation === 'edit'
                ? `编辑${labels[editor.kind]}资料`
                : editor?.operation === 'access'
                  ? '修改成员信息后保存。'
                  : '保存后更新信息，并保留操作历史。'}
          </DialogDescription>
          </header>
          <form className="crm-editor-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="crm-dialog-body">
          {editor?.operation === 'resume-followup' && editor.row && <div className="panel-note">
            <p>恢复这条安排后，沿用原建议执行人和日期重新提醒。可在编辑记录中调整。</p>
            <div className="flex flex-wrap items-center gap-2">建议执行人：{Array.isArray(editor.row.record['建议处理人']) && editor.row.record['建议处理人'].length
              ? <Cell name="建议处理人" value={editor.row.record['建议处理人']} /> : '未指定'}</div>
            <div className="flex flex-wrap items-center gap-2">建议跟进日期：<Cell name="建议日期" value={editor.row.record['建议日期']} /></div>
            {typeof editor.row.record['建议日期'] === 'number' && shanghaiDay(editor.row.record['建议日期']) < currentDay &&
              <p>原建议日期已过，恢复后会显示逾期。</p>}
          </div>}
          {editor?.kind === 'followup' && editor.operation === 'edit' && editor.row && explicitlyEnded(editor.row.record) &&
            <p className="panel-note">这条跟进已主动结束。修改资料不会恢复提醒，需要时可在详情中点击“恢复跟进”。</p>}
          {editor?.operation === 'end-followup' && <p className="panel-note">结束后停止这条安排的提醒，原有内容保留。不影响项目状态及其他人的跟进，需要时可恢复。</p>}
            <fieldset className="form-grid" disabled={saving || uploading || uncertain || !!editor?.savedProjectId}>
              {editor &&
                specs(editor)
                  .filter(showField)
                  .map((f) => (
                    <React.Fragment key={f.key}>{f.key === '上次跟进'
                      ? <PreviousFollowup customerId={followupCustomer} projectId={Array.isArray(draft['关联项目']) ? draft['关联项目'][0] || '' : ''}
                          value={Array.isArray(draft['上次跟进']) ? draft['上次跟进'] : []} disabled={saving || uploading || uncertain}
                          fixed={!!editor.previousFollowupId} onChange={ids => set('上次跟进', ids)} />
                      : <FieldInput
                      key={f.key}
                      field={requiredField(f, editor.kind, editor.operation, draft)}
                      error={fieldErrors[f.key]}
                      draft={draft}
                      customerId={editor.kind === 'followup' && ['关联项目', '客户联系人'].includes(f.key) ? followupCustomer : undefined}
                      onCreateContact={editor.kind === 'followup' && f.key === '客户联系人' ? newContactDuringFollowup : undefined}
                      onChange={set}
                      onUploadBusy={onUploadBusy}
                      disabled={saving || uploading || uncertain || !!editor.savedProjectId || (editor.kind === 'customer' && ['create', 'edit'].includes(editor.operation) && !!customerSave.current.customer) || (editor.kind === 'followup' && f.key === '客户联系人' && !followupCustomer) || (projectResolving && f.key === '关联项目') ||
                        (Boolean(editor.fixedCustomerId) && (f.key === '所属企业' || f.key === FOLLOWUP_CUSTOMER)) ||
                        (Boolean(editor.fixedProjectId) && f.key === '关联项目') ||
                        (Boolean(editor.previousFollowupId) && f.key === '关联项目') ||
                        (Boolean(suspendedEditor.current) && f.key === '所属企业')}
                    />}
                    {editor.kind === 'customer' && ['create', 'edit'].includes(editor.operation) && f.key === '客户负责人' &&
                      <CustomerContactDrafts customerName={String(draft['企业全称'] || '')} contacts={pendingContacts}
                        selected={selectedContacts} disabled={saving || uncertain}
                        lockedSelection={!!customerSave.current.customer} savedKeys={Object.keys(customerSave.current.contacts)}
                        onChange={(contacts, selected) => { setPendingContacts(contacts); setSelectedContacts(selected); }} />}
                    </React.Fragment>
                  ))}
            </fieldset>
            {editor?.kind === 'project' && editor.operation === 'create' &&
              <section className="mt-5 border-t pt-4" aria-label="首次跟进">
                {!editor.firstFollowup ? <Button type="button" variant="outline" disabled={saving || uncertain}
                  onClick={() => {
                    const first = { 记录类型: '外部沟通', 实际发生时间: new Date(Date.now() + 8 * 3600000).toISOString().slice(0,16), 后续安排: '有下一步行动' };
                    firstInitial.current = first;
                    setEditor({ ...editor, firstFollowup: first });
                    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.first-followup textarea')?.focus());
                  }}><Plus size={16} />添加首次跟进</Button> : <>
                  <div className="mb-3 flex items-center justify-between"><strong>首次跟进</strong>
                    {!editor.savedProjectId && <Button type="button" variant="ghost" disabled={saving || uploading || uncertain}
                      onClick={() => {
                        if (JSON.stringify(editor.firstFollowup) !== JSON.stringify(firstInitial.current)) setRemoveFirstOpen(true);
                        else { setEditor({ ...editor, firstFollowup: undefined }); setFieldErrors({}); setSaveError(''); }
                      }}>移除</Button>}</div>
                  <fieldset className="form-grid first-followup" disabled={saving || uploading || uncertain}>
                    {firstFields(editor.firstFollowup).map(f => <FieldInput key={f.key} field={f} draft={editor.firstFollowup!}
                      error={fieldErrors[f.key]} customerId={f.key === '客户联系人' && Array.isArray(draft['所属企业']) ? draft['所属企业'][0] : undefined}
                      disabled={saving || uploading || uncertain || (f.key === '客户联系人' && !draft['所属企业']?.toString())}
                      onUploadBusy={onUploadBusy} onChange={(key,value) => {
                        setEditor(current => current?.firstFollowup ? { ...current, firstFollowup: changeDraft(current.firstFollowup,key,value,firstInitial.current,false) } : current);
                        setFieldErrors(prev => {const next = {...prev}; delete next[key]; return next;});
                      }} />)}
                  </fieldset></>}
              </section>}
            {projectResolving && <p className="panel-note" role="status">正在读取项目所属客户…</p>}
            {customerResolveError && <div role="alert" className="error-banner">{customerResolveError}
              <Button type="button" size="sm" variant="ghost" onClick={() => setCustomerResolveRetry((n) => n + 1)}>重新加载客户</Button></div>}
            </div>
            {saveError && (
              <div className="error-banner save-error" role="alert">
                {saveError}
              </div>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                disabled={saving || uploading}
                onClick={closeEditor}
              >
                {suspendedEditor.current ? '返回跟进' : '取消'}
              </Button>
              <Button type="submit" disabled={saving || uploading || projectResolving || uncertain}>
                {saving ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    正在保存
                  </>
                ) : (
                  editor?.savedProjectId ? '重试保存跟进' : editor?.firstFollowup ? '保存项目及跟进' : '保存'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={removeFirstOpen} onOpenChange={setRemoveFirstOpen}>
        <DialogContent><DialogTitle>移除首次跟进？</DialogTitle>
          <DialogDescription>已填写的跟进内容将丢弃，项目资料会保留。</DialogDescription>
          <div className="form-actions">
            <Button variant="outline" onClick={() => setRemoveFirstOpen(false)}>继续填写</Button>
            <Button variant="destructive" onClick={() => {
              setRemoveFirstOpen(false); setEditor(current => current ? { ...current, firstFollowup: undefined } : null);
              setFieldErrors({}); setSaveError('');
            }}>移除跟进</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>{editor?.savedProjectId ? '项目已创建。关闭后将丢弃未保存的首次跟进内容。' : editor?.kind === 'customer' && ['create', 'edit'].includes(editor.operation) && customerSave.current.customer
            ? '客户及已成功保存的联系人会保留，未保存的联系人草稿将丢失。' : '刚才填写的内容尚未保存，关闭后将丢失。'}</DialogDescription>
          <div className="form-actions">
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>继续填写</Button>
            <Button variant="destructive" onClick={() => { setDiscardOpen(false); if (!resumeFollowup()) { setEditor(null); if (customerSave.current.customer || editor?.savedProjectId) { setDetailRevision(v=>v+1); void reload(); } } }}>放弃修改</Button>
          </div>
        </DialogContent>
      </Dialog>
      {deleteTarget&&<DeleteDialog target={deleteTarget} onClose={()=>{setDeleteTarget(null);setDeleteRevision(value=>value+1);void reload();}}
        onChanged={()=>{detailVersion.current++;editorRequestVersion.current++;setSelection(null);setDetailTrail([]);setDetailRevision(value=>value+1);void reload();}} />}
    </div></RelatedPageMemory.Provider>
  );
};
export default CrmPage;
