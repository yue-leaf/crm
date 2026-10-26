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
  Search,
  RefreshCw,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Eye,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  CrmSummary,
  ProjectOverview,
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
import { projectFilterLabels, validProjectFilter } from '@shared/crm-dashboard';
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
    '客户关系状态',
    '客户负责人',
    '跟进状态',
    '下次跟进日期',
  ],
  contact: ['姓名', '所属企业', '职务', '电话', '邮箱', '联系人状态'],
  project: [
    '项目名称',
    '项目类型',
    '项目负责人',
    '工作状态',
    '终局确认',
    '跟进状态',
    '下次跟进日期',
  ],
  followup: [
    '跟进主题',
    '跟进归属',
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
const specs = (editor: Editor): FieldSpec[] =>
  isLifecycle(editor.operation)
    ? lifecycleFields(editor.kind, editor.operation)
    : editor.operation === 'progress'
    ? progressFields
    : editor.operation === 'edit'
    ? editFields(editor.kind)
    : editor.operation === 'plan'
      ? planFields
      : editor.operation === 'suggest-end'
        ? endFields
        : forms[editor.kind];
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
  const [summary, setSummary] = useState<CrmSummary | null>(null);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<CrmRecord | null>(null);
  const [selectionKind, setSelectionKind] = useState<EntityKind>('customer');
  const [customerContext, setCustomerContext] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('followups');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saveError, setSaveError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const savingRef = useRef(false);
  const detailVersion = useRef(0);
  const editorRequestVersion = useRef(0);
  const initialDraft = useRef<Draft>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const admin = !!session && crmAdmin(session.roles);
  const authorized = !!session && (active !== 'access' || admin);
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
  const reload = useCallback(async () => {
    if (!authorized) return;
    const version = ++requestVersion.current;
    setDetailLoadingId(null);
    setLoading(true);
    setError('');
    try {
      if (active === 'home') {
        setOverview(null);
        const [next, projects] = await Promise.all([api.summary(), api.overview(scope)]);
        if (version === requestVersion.current) { setSummary(next); setOverview(projects); }
      } else {
        const next = await api.list(active, '', query, active === 'project' ? { scope, projectFilter, followupFilter } : active === 'customer' ? { followupFilter } : undefined);
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
    navigate(key === 'home' ? '/' : `/crm/${key}`);
  };
  const openProjectFilter = (filter: ProjectFilter) => {
    requestVersion.current++;
    setSearch(''); setQuery('');
    navigate(`/crm/project?${new URLSearchParams({ scope, projectFilter: filter })}`);
  };
  const openEditor = (
    kind: EntityKind,
    operation = 'create',
    row?: CrmRecord,
    preset: Draft = {},
  ) => {
    if (savingRef.current) return;
    editorRequestVersion.current++;
    detailVersion.current++;
    setOpeningId(null);
    setDetailLoadingId(null);
    const ed = { kind, operation, row };
    const initial: Draft =
      row ? recordDraft(row.record, specs(ed)) : {};
    if (operation === 'create')
      for (const f of specs(ed)) {
        if (f.type === 'person' && f.required)
          initial[f.key] = session ? [session.userId] : [];
        if (f.type === 'select' && f.required)
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
      if (operation === 'reopen' || (operation === 'restore' && kind === 'customer')) {
        initial['当前下一步行动'] = '';
        initial['下次跟进日期'] = '';
        initial['行动执行人'] = [];
      }
    }
    Object.assign(initial, preset);
    initialDraft.current = structuredClone(initial);
    setDraft(initial);
    setSaveError('');
    setFieldErrors({});
    setUncertain(false);
    setEditor(ed);
  };
  const edit = async (row: CrmRecord, kind = active) => {
    if (kind === 'home' || kind === 'access' || openingId) return;
    const version = requestVersion.current;
    const editorRequest = ++editorRequestVersion.current;
    setOpeningId(row.id);
    try {
      const fresh = await api.get(kind, row.id);
      if (version !== requestVersion.current || editorRequest !== editorRequestVersion.current) return;
      const blocked = editBlockedReason(kind, fresh);
      if (blocked) {
        toast.error(blocked);
        return;
      }
      openEditor(kind, 'edit', fresh);
    } catch (e: unknown) {
      if (version === requestVersion.current && editorRequest === editorRequestVersion.current) toast.error(message(e));
    } finally {
      if (editorRequest === editorRequestVersion.current) setOpeningId(null);
    }
  };
  const detail = async (row: CrmRecord, kind = active, contextCustomerId?: string, initialTab: 'followups' | 'contacts' = 'followups') => {
    if (kind === 'home') return;
    const version = requestVersion.current;
    const detailRequest = ++detailVersion.current;
    setDetailLoadingId(row.id);
    try {
      const next = await api.get(kind, row.id);
      if (version === requestVersion.current && detailRequest === detailVersion.current) {
        setSelectionKind(kind);
        setDetailTab(initialTab);
        const parents: string[] = linkIds(next.record[kind === 'followup' ? '直接客户' : '所属企业']);
        setCustomerContext(kind === 'customer' ? next.id : contextCustomerId || (parents.length === 1 ? parents[0] : null));
        setSelection(next);
      }
    } catch (e: unknown) {
      if (version === requestVersion.current && detailRequest === detailVersion.current) toast.error(message(e));
    } finally {
      if (detailRequest === detailVersion.current) setDetailLoadingId(null);
    }
  };
  const closeEditor = () => {
    if (savingRef.current) return;
    if (!uncertain && editor && (
      Object.keys(changedFields(initialDraft.current, draft, specs(editor))).length
    )) {
      setDiscardOpen(true);
      return;
    }
    setEditor(null);
    if (uncertain) {
      setSelection(null);
      void reload();
    }
  };
  const save = async () => {
    if (!editor || savingRef.current || uncertain) return;
    const errors = missingFields(specs(editor).filter(showField).map((field) => requiredField(field, editor.kind, editor.operation, draft)), draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setSaveError('请补全标记的必填项后再保存');
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
      const r =
        editor.operation === 'edit' && editor.row
          ? await api.edit(editor.kind, editor.row.id, {
              changes: changedFields(
                recordDraft(editor.row.record, specs(editor)),
                draft,
                specs(editor),
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
            : await api.create(editor.kind, draft);
      toast.success(r.message);
      setEditor(null);
      setSelection(null);
      const refresh = reload();
      const version = requestVersion.current;
      const detailRequest = ++detailVersion.current;
      await refresh;
      if (version !== requestVersion.current) return;
      try {
        const fresh = await api.get(editor.kind, r.id);
        if (version === requestVersion.current && detailRequest === detailVersion.current) {
          setSelectionKind(editor.kind);
          const parents: string[] = linkIds(fresh.record[editor.kind === 'followup' ? '直接客户' : '所属企业']);
          const fromProject: boolean = editor.kind === 'followup' && selectionKind === 'project'
            && !!selection && linkIds(fresh.record['关联项目']).includes(selection.id);
          setCustomerContext(editor.kind === 'customer' ? fresh.id : parents.length === 1 ? parents[0] : fromProject ? customerContext : null);
          setDetailTab('followups');
          setSelection(fresh);
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
  const set = (key: string, value: Draft[string]) => {
    if (savingRef.current) return;
    setFieldErrors((previous) => {
      const next = { ...previous }; delete next[key];
      if (key === '电话' || key === '邮箱') { delete next['电话']; delete next['邮箱']; }
      return next;
    });
    setDraft((previous) => changeDraft(previous, key, value, initialDraft.current, editor?.operation === 'edit'));
  };
  const showField = (f: FieldSpec) => {
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
      if (f.key === '关联项目') return draft['跟进归属'] === '项目跟进';
      if (f.key === '客户联系人') return draft['记录类型'] === '外部沟通';
      if (['建议下一步行动', '建议处理人', '建议日期'].includes(f.key))
        return draft['后续安排'] === '有下一步行动';
      if (f.key === '无后续动作结论') return draft['后续安排'] === '无后续动作';
    }
    return true;
  };
  return (
    <div className="crm-shell">
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
                  {active !== 'home' && <div className="eyebrow">CUSTOMER & PROJECT WORKSPACE</div>}
                  <h1>
                    {active === 'home' ? '工作台' : sectionLabels[active]}
                  </h1>
                  <p>
                    {active === 'home'
                      ? '掌握项目推进情况，把关注变成下一步行动。'
                      : '与飞书多维表格同步，协作信息集中管理。'}
                  </p>
                </div>
                <div className="heading-actions">
                  {(active === 'home' || active === 'project') && <select className="project-scope" aria-label="项目范围" value={scope} onChange={event => {
                    requestVersion.current++;
                    setSearch(''); setQuery('');
                    navigate(`${active === 'home' ? '/' : '/crm/project'}?${new URLSearchParams({ scope: event.target.value, ...(active === 'project' ? { projectFilter } : {}) })}`);
                  }}><option value="all">全部项目</option><option value="mine">我负责的</option></select>}
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
                        openEditor(active === 'home' ? 'project' : active)
                      }
                    >
                      <Plus size={16} />
                      {active === 'home' ? '新建项目' : `新建${labels[active]}`}
                    </Button>
                  )}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              {active === 'home' ? (
                <ProjectDashboard data={overview} summary={summary} loading={loading}
                  onFilter={openProjectFilter} onNavigate={changePage}
                  onOpen={row => void detail(row, 'project')} onEdit={row => void edit(row, 'project')}
                  onFollowup={row => openEditor('followup', 'create', undefined, relatedDraft('project', row, 'followup'))} />
              ) : (
                <section className="panel list-panel">
                  {active === 'project' && <div className="project-list-filter"><span>项目范围：{scope === 'mine' ? '我负责的' : '全部项目'}</span><span>筛选：{projectFilterLabels[projectFilter]}</span>
                    {(projectFilter !== 'all' || scope !== 'all') && <Button size="sm" variant="ghost" onClick={() => { requestVersion.current++; setQuery(''); setSearch(''); navigate('/crm/project'); }}>清除筛选</Button>}</div>}
                  <form
                    className="list-toolbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = search.trim();
                      if (next === query) void reload(); else setQuery(next);
                    }}
                  >
                    <div className="toolbar-search">
                      <Search size={16} aria-hidden="true" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`搜索${titles[active]}`}
                        aria-label={`搜索${titles[active]}`}
                      />
                    </div>
                    <Button type="submit" variant="outline">
                      搜索
                    </Button>
                    {(active === 'customer' || active === 'project') && <div className="followup-filter"><span>跟进状态</span>
                      <Select value={followupFilter} onValueChange={(value: string) => {
                        requestVersion.current++;
                        const next = new URLSearchParams(params);
                        if (value === 'all') next.delete('followupFilter'); else next.set('followupFilter', value);
                        navigate('/crm/' + active + '?' + next.toString());
                      }}><SelectTrigger aria-label="筛选跟进状态"><SelectValue>{followupFilter === 'all' ? '全部' : followupFilterLabels[followupFilter]}</SelectValue></SelectTrigger>
                        <SelectContent>{Object.entries(followupFilterLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
                      </Select></div>}
                    {(search || query) && <Button type="button" variant="ghost" onClick={() => {
                      setSearch(''); if (query) setQuery(''); else void reload();
                    }}>清空搜索</Button>}
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
                            <th role="columnheader" key={c}>{c === '所属企业' ? '所属客户' : c === '待配置角色' ? '角色' : c}</th>
                          ))}
                          <th role="columnheader">操作</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {data?.records.map((row) => (
                          <tr role="row" key={row.id}>
                            {columns[active].map((c, i) => (
                              <td role="cell" data-label={c === '待配置角色' ? '角色' : c} key={c}>
                                {i === 0 ? (
                                  <button
                                    className="record-title"
                                    disabled={detailLoadingId === row.id}
                                    onClick={() => void detail(row)}
                                  >
                                    {textValue(row.record[c]) || '未命名'}
                                  </button>
                                ) : c === '跟进状态' ? <FollowupBadge record={row.record} /> : (
                                  <Cell name={c} value={row.record[c]} onOpenCustomer={id => void detail({ id, record: {} }, 'customer', undefined, active === 'contact' ? 'contacts' : 'followups')} />
                                )}
                              </td>
                            ))}
                            <td role="cell" data-label="操作" className="record-actions">
                              {active === 'customer' && <Button variant="ghost" size="sm" disabled={detailLoadingId === row.id} onClick={() => void detail(row, 'customer', undefined, 'contacts')}><Users size={14} />联系人</Button>}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                disabled={detailLoadingId === row.id}
                                onClick={() =>
                                  active === 'access'
                                    ? openEditor(active, 'access', row)
                                    : void detail(row)
                                }
                              >
                                {active === 'access' ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                                {detailLoadingId === row.id ? '读取中…' : active === 'access' ? '编辑' : '查看'}
                              </Button>
                              {active !== 'access' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={
                                    !!openingId ||
                                    !!editBlockedReason(active, row)
                                  }
                                  title={
                                    editBlockedReason(active, row) || '编辑资料'
                                  }
                                  onClick={() => void edit(row)}
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                  {openingId === row.id ? '读取中' : '编辑'}
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
                  <div className="list-footer">
                    <span>数据来自飞书 · 保存后自动回读</span>
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
                <span>客户维护与项目计划各自推进，历史记录完整保留。</span>
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
            detailVersion.current++;
            setDetailLoadingId(null);
            setSelection(null);
          }
        }}
      >
        <DialogContent className="crm-dialog crm-detail-dialog" aria-describedby={undefined}>
          <header className="crm-dialog-header">
          {customerContext && selectionKind !== 'customer' && <Button type="button" variant="ghost" size="sm"
            className="detail-customer-back" disabled={!!detailLoadingId}
            onClick={() => void detail({ id: customerContext, record: {} }, 'customer', undefined, selectionKind === 'contact' ? 'contacts' : 'followups')}>
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
              <DetailToolbar kind={selectionKind} row={selection} busy={!!openingId || !!detailLoadingId}
                onEdit={() => void edit(selection, selectionKind)}
                onAction={(operation: string) => openEditor(selectionKind, operation, selection)}
                onFollowup={() => openEditor('followup', 'create', undefined, relatedDraft(
                  selectionKind as 'customer' | 'project', selection, 'followup'))}
                onTarget={() => { const target = followupTarget(selection); if (target) void detail(
                  { id: target.id, record: {} }, target.kind, customerContext || undefined); }} />
              {selectionKind !== 'access' && recordReviewProblem(selectionKind, selection.record) && (
                <p className="panel-note" role="status">{recordReviewProblem(selectionKind, selection.record)}</p>
              )}
              {selectionKind === 'project' && textValue(selection.record['结束建议']) && (
                <p className="panel-note">已有结束建议，可通过“确认项目结束”处理；提出建议不会自动改变终局。</p>
              )}
              {selectionKind === 'customer' || selectionKind === 'project'
                ? <CustomerWorkspace key={`${selectionKind}:${selection.id}`} kind={selectionKind} row={selection}
                    tab={detailTab} onTabChange={setDetailTab}
                    busy={!!openingId || !!detailLoadingId}
                    onView={(row: CrmRecord, kind: EntityKind, customerId?: string) => void detail(row, kind, customerId)}
                    onEditContact={(row: CrmRecord) => void edit(row, 'contact')}
                    onCreate={(kind: 'contact' | 'project') => openEditor(kind, 'create', undefined,
                      relatedDraft('customer', selection, kind))} />
                : <RecordDetails key={`${selectionKind}:${selection.id}`} record={selection.record}
                    onOpenCustomer={(id: string) => void detail({ id, record: {} }, 'customer', undefined, selectionKind === 'contact' ? 'contacts' : 'followups')} />}

            </>
          )}
          </div>
          <div className="form-actions">
            <Button variant="outline" onClick={() => { detailVersion.current++; setDetailLoadingId(null); setSelection(null); }}>关闭详情</Button>
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
              ? isLifecycle(editor.operation)
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
          <DialogDescription className={editor?.operation === 'edit' ? 'sr-only' : undefined}>
            {editor?.operation === 'create'
              ? '填写信息后保存。'
              : editor?.operation === 'edit'
                ? `编辑${labels[editor.kind]}资料`
                : editor?.operation === 'access'
                  ? '修改成员信息后保存。'
                  : '请核对信息后保存，保留历史跟进中的原始建议。'}
          </DialogDescription>
          </header>
          <form className="crm-editor-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="crm-dialog-body">
          {editor?.kind === 'followup' && (
            <p className="panel-note">
              历史补录按实际发生时间填写：结项当天可补录，归档及联系人停用须严格早于对应时刻；新工作请先恢复或重开。
            </p>
          )}
          {editor?.operation === 'progress' && <p className="panel-note">暂停需填写原因，原计划保留；启动或恢复需确认当前行动与日期。</p>}
          {editor && isLifecycle(editor.operation) && <p className="panel-note">
            {editor.operation === 'confirm-end' ? '确认后项目停止活动推进，可在结束后归档。取消项目必须说明原因。'
              : editor.operation === 'archive' ? '归档保留全部业务和历史，停止新增活动。客户的关联项目必须已结束且资料完整。'
              : editor.operation === 'restore' ? '取消归档保留历史归档时间；项目仍保持原结束状态。客户恢复时请填写新计划。'
              : '重开会解除项目归档和终局，必须填写新进展与计划。上次结束日期保留为历史时间，不再参与当前终局统计。'}
          </p>}
          {editor?.operation === 'edit' && editor.kind === 'project' && draft['项目类型'] !== '销售机会' && (
            <p className="panel-note">切换为非销售类型时保留原有商务信息，不新增商务金额；详情仍可查看历史值。</p>
          )}
            <fieldset className="form-grid" disabled={saving || uncertain}>
              {editor &&
                specs(editor)
                  .filter(showField)
                  .map((f) => (
                    <FieldInput
                      key={f.key}
                      field={requiredField(f, editor.kind, editor.operation, draft)}
                      error={fieldErrors[f.key]}
                      draft={draft}
                      onChange={set}
                      disabled={saving || uncertain}
                    />
                  ))}
            </fieldset>
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
                disabled={saving}
                onClick={closeEditor}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving || uncertain}>
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
            <Button variant="destructive" onClick={() => { setDiscardOpen(false); setEditor(null); }}>放弃修改</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default CrmPage;
