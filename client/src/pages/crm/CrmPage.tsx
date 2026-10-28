import { statusFields, currentProjectStatus } from '@shared/crm-status';
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
  labels,
  titles,
  planFields,
  endFields,
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
import { RecordDetails } from './RecordDetails';
import { DetailToolbar } from './DetailToolbar';
import { CustomerWorkspace } from './CustomerWorkspace';
import './customer-workspace.css';
import {
  followupTarget, progressFields, relatedDraft,
} from '@shared/crm-workflow';
import { recordReviewProblem } from '@shared/crm-review';
import { appendPage, changeDraft, missingFields, requiredField } from '@shared/crm-interaction';
import { crmAdmin } from '@shared/crm-access';
import { isLifecycle, lifecycleFields, lifecycleTitles } from '@shared/crm-lifecycle';

import { ProjectDashboard } from './ProjectDashboard';
import { FollowupBadge, useFollowupClock } from './FollowupStatus';
import { followupFilterLabels, validFollowupFilter, shanghaiDay } from '@shared/crm-followup-status';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FollowupFilter } from '@shared/api.interface';
import { projectFacts, validProjectFilter } from '@shared/crm-dashboard';
import { numberValue, detailFieldLabel } from '@shared/crm-presentation';
import { projectFilterLabels } from '@shared/crm-dashboard';
import { changeFilter, actionDraft, suggestedPlan, suggestionKey, readPlanSuggestion } from '@shared/crm-ux';
import { defaultFollowupView, type FollowupView } from './FollowupFeed';
import { RelatedPageMemory } from './RelatedPageMemory';
import type { RelatedPosition } from '@shared/crm-navigation';
import { restoreDetailScroll } from './restoreDetailScroll';
import {
  FOLLOWUP_CUSTOMER, followupCreateFields, changeFollowupTarget, followupWriteDraft,
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
    '跟进状态',
    '下次跟进日期',
  ],
  contact: ['姓名', '所属企业', '职务', '电话', '邮箱', '联系人状态'],
  project: [
    '项目名称',
    '项目类型',
    '所属企业',
    '工作状态',
    '跟进状态',
    '下次跟进日期',
  ],
  followup: [
    '跟进主题',
    '有效客户名称',
    '关联项目',
    '实际发生时间',
    '实际跟进人',
    '记录类型',
  ],
  access: ['姓名', '部门', '待配置角色'],
};
interface Editor {
  kind: EntityKind;
  operation: string;
  row?: CrmRecord;
}
interface DetailLocation { row: CrmRecord; kind: EntityKind; tab: string; customer: string | null; scroll: number }
interface SuspendedEditor { editor: Editor; draft: Draft; initial: Draft; origin: DetailLocation | null }
const rawSpecs = (editor: Editor): FieldSpec[] =>
  editor.operation === 'status' ? statusFields : isLifecycle(editor.operation)
    ? lifecycleFields(editor.kind, editor.operation)
    : editor.operation === 'progress'
    ? progressFields
    : editor.operation === 'edit'
    ? editFields(editor.kind)
    : editor.operation === 'plan'
      ? planFields
      : editor.operation === 'suggest-end'
        ? endFields
        : editor.kind === 'followup' ? followupCreateFields : forms[editor.kind];
const specs = (editor: Editor): FieldSpec[] => rawSpecs(editor)
  .filter((field: FieldSpec) => !(editor.operation === 'progress' && field.key === '变更说明') &&
    !(editor.operation === 'confirm-end' && field.key === '操作原因'))
  .map((field: FieldSpec) => ({ ...field, label: field.label || detailFieldLabel(field.key) }));
const CrmPage: React.FC = () => {
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
  const profile = useCurrentUserProfile();
  const [session, setSession] = useState<CrmSession | null>(null);
  const [overview, setOverview] = useState<WorkspaceData | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<CrmRecord | null>(null);
  const [selectionKind, setSelectionKind] = useState<EntityKind>('customer');
  const [detailTrail, setDetailTrail] = useState<DetailLocation[]>([]);
  const [followupViews, setFollowupViews] = useState<Record<string, FollowupView>>({});
  const relatedMemory = useRef(new Map<string, RelatedPosition>());
  const [scrollRequest, setScrollRequest] = useState<{ key: string; tab: string; top: number } | null>(null);
  const editorOrigin = useRef<DetailLocation | null>(null);
  const suspendedEditor = useRef<SuspendedEditor | null>(null);
  const [receipt, setReceipt] = useState<{ kind: EntityKind; row: CrmRecord } | null>(null);
  const planSuggestion = useRef<string | null>(null);
  const [adoptedSuggestions, setAdoptedSuggestions] = useState<Set<string>>(new Set());
  const [followupCustomer, setFollowupCustomer] = useState('');
  const [customerResolveError, setCustomerResolveError] = useState('');
  const [customerResolveRetry, setCustomerResolveRetry] = useState(0);
  const [customerContext, setCustomerContext] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('followups');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>({});
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
        setOverview(null);
        const next = await api.workspace(scope);
        if (version === requestVersion.current) setOverview(next);
      } else {
        const filters = active === 'project' ? { scope, projectFilter, followupFilter } : active === 'customer' ? { followupFilter } : undefined;
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
  }, [active, authorized, query, scope, projectFilter, followupFilter, currentDay]);
  useEffect(() => {
    setData(null);
    setSelection(null);
    void reload();
    return () => {
      requestVersion.current++;
    };
  }, [reload]);
  const changePage = (key: EntityKind | 'home') => {
    requestVersion.current++;
    setSearch('');
    setQuery('');
    setDetailTrail([]); setReceipt(null);
    navigate(key === 'home' ? '/' : `/crm/${key}`);
  };
  const updateFilter = (key: string, value: string) => {
    requestVersion.current++;
    // Read the latest URL so consecutive changes cannot overwrite a pending router render.
    const next = changeFilter(new URLSearchParams(window.location.search), key, value);
    navigate(`${active === 'home' ? '/' : '/crm/' + active}?${next}`);
  };
  const openEditor = (
    kind: EntityKind,
    operation = 'create',
    row?: CrmRecord,
    preset: Draft = {},
  ) => {
    if (savingRef.current || uploadingRef.current) return;
    editorOrigin.current = currentLocation();
    planSuggestion.current = null;
    setFollowupCustomer(''); setCustomerResolveError('');
    editorRequestVersion.current++;
    detailVersion.current++;
    const ed = { kind, operation, row };
    const initial: Draft =
      row ? recordDraft(row.record, specs(ed)) : {};
    if (operation === 'create')
      for (const f of specs(ed)) {
        if (f.type === 'person' && f.required)
          initial[f.key] = session ? [session.userId] : [];
        if (f.type === 'select' && f.required && !['行业', '项目类型'].includes(f.key))
          initial[f.key] = f.options?.[0] || '';
      }
    if (kind === 'followup' && operation === 'create') {
      initial['实际发生时间'] = new Date(Date.now() + 8 * 3600000)
        .toISOString()
        .slice(0, 16);
      initial['后续安排'] = '有下一步行动';
    }
    if (isLifecycle(operation)) {
      initial['操作原因'] = '';
      if (operation === 'confirm-end') {
        initial['终局确认'] = textValue(row?.record['结束建议']) === '申请取消' ? '已取消' : '已完成';
        initial['结束日期'] = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
        initial['结果说明'] = textValue(row?.record['建议说明']);
        initial['取消原因'] = '';
      }
      if (operation === 'reopen') initial['工作状态'] = '进行中';
      if (operation === 'reopen') {
        initial['当前下一步行动'] = '';
        initial['下次跟进日期'] = '';
        initial['行动执行人'] = [];
      }
    }
    if (operation === 'status' && row) {
      initial['项目状态'] = currentProjectStatus(row);
      initial['签约日期'] ||= new Date(Date.now() + 28800000).toISOString().slice(0, 10);
      if (initial['项目状态'] !== '已取消' || !initial['结束日期']) initial['结束日期'] = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
    }
    Object.assign(initial, preset);
    initialDraft.current = structuredClone(initial);
    setDraft(initial);
    setSaveError('');
    setFieldErrors({});
    setUncertain(false);
    setEditor(ed);
  };
  const edit = async (row: CrmRecord, kind = active, operation = 'edit') => {
    if (kind === 'home' || kind === 'access' || savingRef.current || uploadingRef.current) return;
    detailVersion.current++;
    const version = requestVersion.current;
    const editorRequest = ++editorRequestVersion.current;

    try {
      const fresh = await api.get(kind, row.id);
      if (version !== requestVersion.current || editorRequest !== editorRequestVersion.current) return;
      const blocked = operation === 'status' ? '' : editBlockedReason(kind, fresh);
      if (blocked) {
        toast.error(blocked);
        return;
      }
      openEditor(kind, operation, fresh);
    } catch (e: unknown) {
      if (version === requestVersion.current && editorRequest === editorRequestVersion.current) toast.error(message(e));
    }
  };
  const detail = async (row: CrmRecord, kind = active, contextCustomerId?: string, initialTab: 'followups' | 'contacts' | 'projects' = 'followups') => {
    if (kind === 'home' || savingRef.current || uploadingRef.current) return;
    editorRequestVersion.current++;
    const version = requestVersion.current;
    const detailRequest = ++detailVersion.current;
    try {
      const next = await api.get(kind, row.id);
      if (version === requestVersion.current && detailRequest === detailVersion.current) {
        const previous = currentLocation();
        if (previous && (previous.row.id !== next.id || previous.kind !== kind)) setDetailTrail((trail) => [...trail, previous]);
        if (!previous) setDetailTrail([]);
        setScrollRequest(null);
        setReceipt(null);
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
  const workspaceAction = async (kind: 'customer' | 'project', id: string, operation: 'followup' | 'plan') => {
    if (savingRef.current || uploadingRef.current) return;
    detailVersion.current++;
    const version = requestVersion.current;
    const editorRequest = ++editorRequestVersion.current;

    try {
      const row = await api.get(kind, id);
      if (version !== requestVersion.current || editorRequest !== editorRequestVersion.current) return;
      const blocked = advancementBlocked(kind, row);
      if (blocked) { toast.error(blocked); return; }
      if (operation === 'followup') openEditor('followup', 'create', undefined, relatedDraft(kind, row, 'followup'));
      else openEditor(kind, 'plan', row, recordDraft(row.record, planFields));
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
    if (!uncertain && editor && (
      Object.keys(changedFields(initialDraft.current, draft, specs(editor))).length
    )) {
      setDiscardOpen(true);
      return;
    }
    if (uncertain && suspendedEditor.current) toast.info('联系人保存结果待确认，请先搜索刚才填写的姓名，避免重复新增。');
    if (resumeFollowup()) return;
    setEditor(null);
    if (uncertain) {
      setSelection(null);
      void reload();
    }
  };
  const save = async () => {
    if (!editor || savingRef.current || uploadingRef.current || uncertain) return;
    const errors = missingFields(specs(editor).filter(showField).map((field) => requiredField(field, editor.kind, editor.operation, draft)), draft);
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
    try {
      const submitted = editor.operation === 'status'
        ? Object.fromEntries(specs(editor).filter(showField).map(f => [f.key, draft[f.key] ?? null]))
        : actionDraft(editor.operation, draft);
      const r =
        editor.operation === 'edit' && editor.row
          ? await api.edit(editor.kind, editor.row.id, {
              changes: changedFields(
                recordDraft(editor.row.record, specs(editor)),
                submitted,
                specs(editor),
              ),
              expectedModifiedAt: Number(editor.row.record['修改时间']),
            })
          : editor.row
            ? await api.update(
                editor.kind,
                editor.row.id,
                editor.operation,
                submitted,
                Number(editor.row.record['修改时间']),
              )
            : await api.create(editor.kind, editor.kind === 'followup' ? followupWriteDraft(draft) : draft);
      toast.success(r.message);
      if (editor.operation === 'plan' && planSuggestion.current) {
        const id = planSuggestion.current;
        setAdoptedSuggestions((previous) => new Set([...previous, id]));
      }
      if (suspendedEditor.current) { resumeFollowup(r.id); return; }
      const origin = editorOrigin.current;
      setEditor(null);
      setSelection(null);
      setReceipt(null);
      const refresh = reload(data?.records.length || 0);
      const version = requestVersion.current;
      const detailRequest = ++detailVersion.current;
      await refresh;
      if (version !== requestVersion.current || !origin) return;
      try {
        const fresh = await api.get(editor.kind, r.id);
        if (version === requestVersion.current && detailRequest === detailVersion.current) {
          if (origin) {
            const parent = origin.kind === editor.kind && origin.row.id === fresh.id ? fresh : await api.get(origin.kind, origin.row.id);
            if (version !== requestVersion.current || detailRequest !== detailVersion.current) return;
            restoreLocation(origin, parent);
            if (editor.operation === 'create' && editor.kind === 'followup') setReceipt({ kind: editor.kind, row: fresh });
            else setReceipt((previous) => previous?.kind === editor.kind && previous.row.id === fresh.id
              ? { kind: editor.kind, row: fresh } : previous);
            return;
          }
        }
      } catch {
        toast.info('保存已完成，详情暂时加载失败，请从列表重新打开');
      }
    } catch (e: unknown) {
      if (e instanceof SaveOutcomeUnknown) setUncertain(true);
      setSaveError(message(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const adoptPlan = async (followup: CrmRecord) => {
    if (savingRef.current || uploadingRef.current) return;
    const version = requestVersion.current;
    const detailRequest = ++detailVersion.current;
    const editorRequest = ++editorRequestVersion.current;

    try {
      const next = await readPlanSuggestion(followup.id, api.get);
      if (version !== requestVersion.current || detailRequest !== detailVersion.current ||
        editorRequest !== editorRequestVersion.current) return;
      setReceipt((previous) => previous?.kind === 'followup' && previous.row.id === next.followup.id
        ? { kind: 'followup', row: next.followup } : previous);
      if (selectionKind === 'followup' && selection?.id === next.followup.id) setSelection(next.followup);
      openEditor(next.target.kind, 'plan', next.row, next.preset);
      planSuggestion.current = next.key;
    } catch (e: unknown) {
      if (version === requestVersion.current && detailRequest === detailVersion.current &&
        editorRequest === editorRequestVersion.current) toast.error(message(e));
    }
  };
  const set = (key: string, value: Draft[string]) => {
    if (savingRef.current || (uploadingRef.current && key !== '附件')) return;
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
    if (editor?.operation === 'status') {
      const state = draft['项目状态'];
      if (f.key === '项目状态') return true;
      if (state === '已取消') return ['结束日期', '取消原因'].includes(f.key);
      if (['结束日期', '取消原因'].includes(f.key)) return false;
      if (f.key === '暂停原因') return state === '暂停';
      if (f.key === '签约日期') return state === '已签合同';
      if (planFields.some(field => field.key === f.key)) return state !== '暂停';
    }
    if (editor?.operation === 'confirm-end' && f.key === '结果说明') return draft['终局确认'] !== '已取消';
    if (editor?.kind === 'contact' && f.key === '停用原因') return draft['联系人状态'] === '停用';
    if (editor?.operation === 'confirm-end' && f.key === '取消原因') return draft['终局确认'] === '已取消';
    if (editor?.operation === 'progress') {
      if (f.key === '暂停原因') return draft['工作状态'] === '暂停';
      if (planFields.some((field) => field.key === f.key)) return draft['工作状态'] !== '暂停';
    }
    if (
      editor?.kind === 'project' &&
      ['预计金额', '币种', '金额含税口径'].includes(f.key)
    )
      return draft['项目类型'] === '销售机会';
    if (editor?.kind === 'followup') {
      if (f.key === '直接客户') return draft['跟进归属'] === '客户直接跟进';
      if (f.key === '关联项目') return true;
      if (f.key === '客户联系人') return draft['记录类型'] === '外部沟通';
      if (['建议下一步行动', '建议处理人', '建议日期'].includes(f.key))
        return draft['后续安排'] === '有下一步行动';
      if (f.key === '无后续动作结论') return draft['后续安排'] === '无后续动作';
    }
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
          {(Object.keys(labels) as EntityKind[]).filter(key => key !== 'access' || admin).map((key) => {
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
        <main className="crm-content">
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
                  onAction={(kind, id, operation) => workspaceAction(kind, id, operation)}
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
                    <div className="toolbar-search">
                      <Label htmlFor="crm-list-search">{active === 'customer' ? '企业名称' : titles[active]}</Label>
                      <Input
                        id="crm-list-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`请输入${active === 'customer' ? '企业名称' : titles[active]}`}
                      />
                    </div>
                    {(active === 'customer' || active === 'project') && <div className="followup-filter"><span>跟进状态</span>
                      <Select value={followupFilter} onValueChange={(value: string) => {
                        updateFilter('followupFilter', value);
                      }}><SelectTrigger aria-label="筛选跟进状态"><SelectValue>{followupFilter === 'all' ? '全部' : followupFilterLabels[followupFilter]}</SelectValue></SelectTrigger>
                        <SelectContent>{Object.entries(followupFilterLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
                      </Select></div>}
                    <Button type="submit" variant="outline">
                      搜索
                    </Button>
                    {(search || query) && <Button type="button" variant="ghost" onClick={() => {
                      setSearch(''); if (query) setQuery(''); else void reload();
                    }}>清空搜索</Button>}
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
                            <th role="columnheader" key={c}>{detailFieldLabel(c)}</th>
                          ))}
                          <th role="columnheader">操作</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {data?.records.map((row) => (
                          <tr role="row" key={row.id}>
                            {columns[active].map((c, i) => (
                              <td role="cell" data-label={detailFieldLabel(c)} key={c}>
                                {i === 0 ? (
                                  <button
                                    className="record-title"
                                    disabled={saving || uploading}
                                    onClick={() => detail(row)}
                                  >
                                    {textValue(row.record[c]) || '未命名'}
                                  </button>
                                ) : active === 'project' && c === '工作状态' ? (
                                  <Cell name="工作状态" value={projectFacts(row, Date.now()).state || '状态异常'} />
                                ) : c === '跟进状态' ? <FollowupBadge record={row.record} /> : (
                                  <Cell name={c} value={row.record[c]} onOpenCustomer={id => detail({ id, record: {} }, 'customer', undefined, active === 'contact' ? 'contacts' : 'followups')}
                                    onOpenRecord={(id, kind) => detail({ id, record: {} }, kind)} />
                                )}
                              </td>
                            ))}
                            <td role="cell" data-label="操作" className="record-actions">
                              {active === 'project' && <Button variant="ghost" size="sm" disabled={saving || uploading} onClick={() => edit(row, 'project', 'status')}><RefreshCw size={14} />更新状态</Button>}
                              {active === 'customer' && <Button variant="ghost" size="sm" disabled={saving || uploading} onClick={() => detail(row, 'customer', undefined, 'contacts')}><Users size={14} />联系人</Button>}
                              <Button
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
                              </Button>
                              {active !== 'access' && (
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
                              active === 'project' ? { scope, projectFilter, followupFilter } : active === 'customer' ? { followupFilter } : undefined,
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
          if (!open) {
            editorRequestVersion.current++;
            detailVersion.current++;

            setSelection(null);
            setDetailTrail([]); setReceipt(null);
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
                setDetailTrail((trail) => trail.slice(0, -1)); setReceipt(null); restoreLocation(previous, fresh);
              } catch (e: unknown) { if (version === detailVersion.current) toast.error(message(e)); }
            }}><ArrowLeft size={14} />返回{textValue(detailTrail[detailTrail.length - 1].row.record[titles[detailTrail[detailTrail.length - 1].kind]]) || '上一页'}</Button>
          : customerContext && selectionKind !== 'customer' && <Button type="button" variant="ghost" size="sm"
            className="detail-customer-back" disabled={saving || uploading}
            onClick={() => detail({ id: customerContext, record: {} }, 'customer', undefined, selectionKind === 'contact' ? 'contacts' : selectionKind === 'project' ? 'projects' : 'followups')}>
            <ArrowLeft size={14} />返回客户全览</Button>}
          <DialogTitle>
            {selection
              ? textValue(selection.record[titles[selectionKind]])
              : '记录详情'}
          </DialogTitle>
          </header>
          <div className="crm-dialog-body">
          {selection && (
            <>
              {((receipt?.kind === 'followup' && !adoptedSuggestions.has(suggestionKey(receipt.row)) && suggestedPlan(receipt.row.record)) ||
                (selectionKind === 'followup' && !adoptedSuggestions.has(suggestionKey(selection)) && suggestedPlan(selection.record))) && <div className="panel-note flex flex-wrap items-center gap-2">
                <span>下一步建议已记录，当前计划需单独确认更新。</span>
                <Button size="sm" variant="outline" disabled={saving || uploading}
                  onClick={() => adoptPlan(receipt?.kind === 'followup' ? receipt.row : selection)}>采用建议更新计划</Button>
              </div>}
              <DetailToolbar key={`toolbar:${selectionKind}:${selection.id}`} kind={selectionKind} row={selection} busy={saving || uploading}
                onEdit={() => edit(selection, selectionKind)}
                onAction={(operation: string) => openEditor(selectionKind, operation, selection)}
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
                ? <CustomerWorkspace key={`workspace:${selectionKind}:${selection.id}`} kind={selectionKind} row={selection}
                    followupView={followupViews[`${selectionKind}:${selection.id}`] || defaultFollowupView}
                    onFollowupViewChange={(view) => setFollowupViews((previous) => ({ ...previous,
                      [`${selectionKind}:${selection.id}`]: view }))}
                    tab={detailTab} onTabChange={(tab) => { setScrollRequest(null); setDetailTab(tab); }}
                    busy={saving || uploading}
                    onView={(row: CrmRecord, kind: EntityKind, customerId?: string) => detail(row, kind, customerId)}
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
            <Button variant="outline" onClick={() => { editorRequestVersion.current++; detailVersion.current++; setSelection(null); setDetailTrail([]); setReceipt(null); }}>关闭详情</Button>
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
              ? editor.operation === 'status' ? '更新项目状态' : isLifecycle(editor.operation)
                ? lifecycleTitles[editor.operation]
                : editor.operation === 'create'
                ? `新建${labels[editor.kind]}`
                : editor.operation === 'edit'
                  ? `编辑${labels[editor.kind]}`
                  : editor.operation === 'progress'
                    ? '更新项目进展'
                  : editor.operation === 'plan'
                    ? '调整当前计划'
                      : editor.operation === 'access'
                        ? '编辑权限配置'
                        : '提出结束建议'
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
          {editor?.operation === 'plan' && editor.row && <p className="panel-note">当前计划：{textValue(editor.row.record['当前下一步行动']) || '尚未安排'}。保存后将采用下方计划。</p>}
          {editor && isLifecycle(editor.operation) && <p className="panel-note">
            {editor.operation === 'confirm-end' ? '确认后项目停止活动推进，可在结束后归档。取消项目必须说明原因。'
              : '重开后项目恢复推进，请填写新的进展和计划。历史记录会保留。'}
          </p>}
            <fieldset className="form-grid" disabled={saving || uploading || uncertain}>
              {editor &&
                specs(editor)
                  .filter(showField)
                  .map((f) => (
                    <FieldInput
                      key={f.key}
                      field={requiredField(f, editor.kind, editor.operation, draft)}
                      error={fieldErrors[f.key]}
                      draft={draft}
                      customerId={editor.kind === 'followup' && ['关联项目', '客户联系人'].includes(f.key) ? followupCustomer : undefined}
                      onCreateContact={editor.kind === 'followup' && f.key === '客户联系人' ? newContactDuringFollowup : undefined}
                      onChange={set}
                      onUploadBusy={onUploadBusy}
                      disabled={saving || uploading || uncertain || (editor.kind === 'followup' && ['关联项目', '客户联系人'].includes(f.key) && !followupCustomer) ||
                        (Boolean(suspendedEditor.current) && f.key === '所属企业')}
                    />
                  ))}
            </fieldset>
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
              <Button type="submit" disabled={saving || uploading || uncertain}>
                {saving ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    正在保存
                  </>
                ) : (
                  '保存'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>刚才填写的内容尚未保存，关闭后将丢失。</DialogDescription>
          <div className="form-actions">
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>继续填写</Button>
            <Button variant="destructive" onClick={() => { setDiscardOpen(false); if (!resumeFollowup()) setEditor(null); }}>放弃修改</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div></RelatedPageMemory.Provider>
  );
};
export default CrmPage;
