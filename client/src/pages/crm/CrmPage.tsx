import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  CheckCircle2,
  LoaderCircle,
  Pencil,
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
import {
  advancementBlocked, commerceKeys, followupTarget, progressFields, relatedDraft,
} from '@shared/crm-workflow';
import { recordReviewProblem } from '@shared/crm-review';
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
    '下次跟进日期',
    '核查标记',
  ],
  contact: ['姓名', '职务', '电话', '邮箱', '联系人状态', '核查标记'],
  project: [
    '项目名称',
    '项目类型',
    '项目负责人',
    '工作状态',
    '终局确认',
    '下次跟进日期',
    '核查标记',
  ],
  followup: [
    '跟进主题',
    '跟进归属',
    '实际发生时间',
    '实际跟进人',
    '记录类型',
    '核查标记',
  ],
  access: ['姓名', '部门', '目录状态', '待配置角色', '处理请求'],
};
interface Editor {
  kind: EntityKind;
  operation: string;
  row?: CrmRecord;
}
const specs = (editor: Editor): FieldSpec[] =>
  editor.operation === 'progress'
    ? progressFields
    : editor.operation === 'edit'
    ? editFields(editor.kind)
    : editor.operation === 'plan'
      ? planFields
      : editor.operation === 'suggest-end'
        ? endFields
        : editor.operation === 'review'
          ? [{ key: '核查说明', type: 'long', required: true }]
          : forms[editor.kind];
const CrmPage: React.FC = () => {
  const navigate = useNavigate();
  const { section } = useParams();
  const active = crmSection(section);
  const profile = useCurrentUserProfile();
  const [session, setSession] = useState<CrmSession | null>(null);
  const [summary, setSummary] = useState<CrmSummary | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<CrmRecord | null>(null);
  const [selectionKind, setSelectionKind] = useState<EntityKind>('customer');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const savingRef = useRef(false);
  const detailVersion = useRef(0);
  const initialDraft = useRef<Draft>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const authorized = !!session?.roles.includes('crm_admin');
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
    setLoading(true);
    setError('');
    try {
      if (active === 'home') {
        const next = await api.summary();
        if (version === requestVersion.current) setSummary(next);
      } else {
        const next = await api.list(active, '', query);
        if (version === requestVersion.current) setData(next);
      }
    } catch (e: unknown) {
      if (version === requestVersion.current) setError(message(e));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [active, authorized, query]);
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
  const openEditor = (
    kind: EntityKind,
    operation = 'create',
    row?: CrmRecord,
    preset: Draft = {},
  ) => {
    if (savingRef.current) return;
    const ed = { kind, operation, row };
    const initial: Draft =
      row && operation !== 'review' ? recordDraft(row.record, specs(ed)) : {};
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
    Object.assign(initial, preset);
    initialDraft.current = structuredClone(initial);
    setDraft(initial);
    setSaveError('');
    setEditReason('');
    setUncertain(false);
    setEditor(ed);
  };
  const edit = async (row: CrmRecord, kind = active) => {
    if (kind === 'home' || kind === 'access' || openingId) return;
    const version = requestVersion.current;
    setOpeningId(row.id);
    try {
      const fresh = await api.get(kind, row.id);
      if (version !== requestVersion.current) return;
      const blocked = editBlockedReason(kind, fresh);
      if (blocked) {
        toast.error(blocked);
        return;
      }
      openEditor(kind, 'edit', fresh);
    } catch (e: unknown) {
      toast.error(message(e));
    } finally {
      setOpeningId(null);
    }
  };
  const detail = async (row: CrmRecord, kind = active) => {
    if (kind === 'home') return;
    const version = requestVersion.current;
    const detailRequest = ++detailVersion.current;
    try {
      const next = await api.get(kind, row.id);
      if (version === requestVersion.current && detailRequest === detailVersion.current) {
        setSelectionKind(kind);
        setSelection(next);
      }
    } catch (e: unknown) {
      toast.error(message(e));
    }
  };
  const closeEditor = () => {
    if (savingRef.current) return;
    if (!uncertain && editor && (
      editReason.trim() || Object.keys(changedFields(initialDraft.current, draft, specs(editor))).length
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
              reason: editReason,
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
  const set = (key: string, value: Draft[string]) =>
    setDraft((prev) => {
      if (savingRef.current) return prev;
      const next = { ...prev, [key]: value };
      if (key === '跟进归属') {
        next['直接客户'] = [];
        next['关联项目'] = [];
        next['客户联系人'] = [];
      }
      if (key === '直接客户' || key === '关联项目') next['客户联系人'] = [];
      if (key === '记录类型') {
        next['客户联系人'] = [];
        next['沟通 / 推进方式'] = '';
      }
      if (key === '后续安排')
        for (const k of [
          '建议下一步行动',
          '建议日期',
          '建议处理人',
          '无后续动作结论',
        ])
          next[k] = null;
      if (key === '项目类型' && value !== '销售机会')
        for (const k of commerceKeys)
          next[k] = editor?.operation === 'edit' ? initialDraft.current[k] ?? null : null;
      return next;
    });
  const showField = (f: FieldSpec) => {
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
          {(Object.keys(labels) as EntityKind[]).map((key) => {
            const Icon = icons[key];
            return (
              <Button
                key={key}
                variant="ghost"
                className={active === key ? 'selected' : ''}
                onClick={() => changePage(key)}
              >
                <Icon size={18} />
                {labels[key]}
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
            {active === 'home' ? '工作台' : labels[active]}
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
              <h1>{loading ? '正在核验登录身份' : '尚未获得应用权限'}</h1>
              <p>
                {error || '当前账号尚未获授 CRM 管理员角色，请联系管理员核对。'}
              </p>
              <p>授权名单中的角色意向，不等同于妙搭实际角色。</p>
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
                  <div className="eyebrow">CUSTOMER & PROJECT WORKSPACE</div>
                  <h1>
                    {active === 'home' ? '让下一步，更清晰' : labels[active]}
                  </h1>
                  <p>
                    {active === 'home'
                      ? '连接客户、项目与每一次有效跟进。'
                      : '与飞书多维表格同步，协作信息集中管理。'}
                  </p>
                </div>
                <div className="heading-actions">
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
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              {active === 'home' ? (
                <>
                  <div className="stats" data-ai-section-type="card-stat">
                    {(
                      ['customer', 'project', 'contact', 'followup'] as const
                    ).map((k) => {
                      const Icon = icons[k];
                      return (
                        <button
                          key={k}
                          className="stat"
                          onClick={() => changePage(k)}
                        >
                          <div>
                            {labels[k]}
                            <Icon size={20} />
                          </div>
                          <strong>{summary ? summary[k] : '—'}</strong>
                          <small>
                            全部记录，含待核查及历史 <ArrowUpRight size={14} />
                          </small>
                        </button>
                      );
                    })}
                  </div>
                  <div className="home-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>开始今天的协作</h2>
                        <span className="tag">工作流程</span>
                      </div>
                      <div className="workflow">
                        {[
                          ['customer', '建立客户档案', '确认企业信息与负责人'],
                          [
                            'project',
                            '明确项目目标',
                            '分配负责人，安排当前计划',
                          ],
                          [
                            'followup',
                            '记录推进过程',
                            '记下事实、参与人及后续建议',
                          ],
                        ].map(([k, title, sub], i) => (
                          <button
                            key={k}
                            onClick={() => openEditor(k as EntityKind)}
                          >
                            <span>{String(i + 1).padStart(2, '0')}</span>
                            <div>
                              <h3>{title}</h3>
                              <p>{sub}</p>
                            </div>
                            <ChevronRight size={18} />
                          </button>
                        ))}
                      </div>
                      <div className="panel-note">
                        跟进建议保留在历史记录中，由负责人确认后更新当前计划。
                      </div>
                    </section>
                    <section className="blue-panel">
                      <CheckCircle2 size={27} />
                      <h2>从记录，到推进</h2>
                      <p>
                        新建资料先进入待核查。核查通过且数据检查无异常后，才符合正常统计条件；作废跟进仍不计为有效记录。
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => changePage('followup')}
                      >
                        查看跟进记录
                        <ArrowUpRight size={15} />
                      </Button>
                    </section>
                  </div>
                </>
              ) : (
                <section className="panel list-panel">
                  {active === 'access' && (
                    <div className="panel-note">
                      这里维护成员资料与授权意向。实际访问由妙搭角色控制，修改本表不会自动授予角色。
                    </div>
                  )}
                  <form
                    className="list-toolbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setQuery(search);
                    }}
                  >
                    <div>
                      <Search size={17} />
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
                    <span>
                      {loading
                        ? '正在读取飞书记录'
                        : `本页 ${data?.records.length ?? 0} 条`}
                    </span>
                  </form>
                  <div className="table-scroll">
                    <table role="table" aria-label={labels[active]}>
                      <thead role="rowgroup">
                        <tr role="row">
                          {columns[active].map((c) => (
                            <th role="columnheader" key={c}>{c}</th>
                          ))}
                          <th role="columnheader">操作</th>
                        </tr>
                      </thead>
                      <tbody role="rowgroup">
                        {data?.records.map((row) => (
                          <tr role="row" key={row.id}>
                            {columns[active].map((c, i) => (
                              <td role="cell" data-label={c} key={c}>
                                {i === 0 ? (
                                  <button
                                    className="record-title"
                                    onClick={() => void detail(row)}
                                  >
                                    {textValue(row.record[c]) || '未命名'}
                                  </button>
                                ) : (
                                  <Cell name={c} value={row.record[c]} />
                                )}
                              </td>
                            ))}
                            <td role="cell" data-label="操作" className="record-actions">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  active === 'access'
                                    ? openEditor(active, 'access', row)
                                    : void detail(row)
                                }
                              >
                                {active === 'access' ? '维护意向' : '查看'}
                                <ChevronRight size={14} />
                              </Button>
                              {active !== 'access' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={
                                    !!openingId ||
                                    !!editBlockedReason(active, row)
                                  }
                                  title={
                                    editBlockedReason(active, row) || '编辑资料'
                                  }
                                  onClick={() => void edit(row)}
                                >
                                  <Pencil size={14} />
                                  {openingId === row.id ? '读取中' : '编辑'}
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!loading && !data?.records.length && !error && (
                    <div className="empty-table">
                      暂无匹配记录，可尝试其他关键词。
                    </div>
                  )}
                  <div className="list-footer">
                    <span>数据来自飞书 · 保存后自动回读</span>
                    {data?.hasMore && (
                      <Button
                        variant="outline"
                        disabled={loading}
                        onClick={async () => {
                          const version = ++requestVersion.current;
                          setLoading(true);
                          try {
                            const next = await api.list(
                              active,
                              data.pageToken,
                              query,
                            );
                            if (version === requestVersion.current)
                              setData(next);
                          } catch (e: unknown) {
                            if (version === requestVersion.current)
                              setError(message(e));
                          } finally {
                            if (version === requestVersion.current)
                              setLoading(false);
                          }
                        }}
                      >
                        下一页
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
            setSelection(null);
          }
        }}
      >
        <DialogContent className="crm-dialog">
          <header className="crm-dialog-header">
          <DialogTitle>
            {selection
              ? textValue(selection.record[titles[selectionKind]])
              : '记录详情'}
          </DialogTitle>
          <DialogDescription>{labels[selectionKind]} · 时间按北京时间展示</DialogDescription>
          </header>
          <div className="crm-dialog-body">
          {selection && (
            <>
              <div className="detail-actions">
                {selectionKind !== 'access' && (
                  <Button
                    variant="outline"
                    disabled={
                      !!openingId || !!editBlockedReason(selectionKind, selection)
                    }
                    title={editBlockedReason(selectionKind, selection) || '编辑资料'}
                    onClick={() => void edit(selection, selectionKind)}
                  >
                    <Pencil size={15} />
                    编辑资料
                  </Button>
                )}
                {(selectionKind === 'customer' || selectionKind === 'project') && (
                  <Button disabled={!!advancementBlocked(selectionKind, selection)}
                    title={advancementBlocked(selectionKind, selection)}
                    onClick={() => openEditor(selectionKind, 'plan', selection)}>
                    调整当前计划
                  </Button>
                )}
                {selectionKind === 'project' && (
                  <Button variant="outline" disabled={!!advancementBlocked('project', selection)}
                    title={advancementBlocked('project', selection)}
                    onClick={() => openEditor('project', 'progress', selection)}>
                    更新项目进展
                  </Button>
                )}
                {selectionKind === 'project' && (
                  <Button
                    variant="outline"
                    disabled={!!advancementBlocked('project', selection)}
                    title={advancementBlocked('project', selection)}
                    onClick={() =>
                      openEditor('project', 'suggest-end', selection)
                    }
                  >
                    提出结束建议
                  </Button>
                )}
                {selectionKind !== 'access' &&
                  textValue(selection.record['核查标记']) === '待核查' && (
                    <Button
                      variant="outline"
                      disabled={!!recordReviewProblem(selectionKind, selection.record)}
                      title={recordReviewProblem(selectionKind, selection.record) || undefined}
                      onClick={() => openEditor(selectionKind, 'review', selection)}
                    >
                      核查通过
                    </Button>
                  )}
                {(selectionKind === 'customer' || selectionKind === 'project') && (
                  <>
                    {selectionKind === 'customer' && (['contact', 'project'] as const).map((kind) => (
                      <Button key={kind} variant="outline"
                        disabled={selection.record['已归档'] === true || textValue(selection.record['核查标记']) !== '正常'}
                        title="先核查客户，通过后可创建联系人和项目"
                        onClick={() => openEditor(
                          kind, 'create', undefined, relatedDraft('customer', selection, kind),
                        )}>
                        新建{labels[kind]}
                      </Button>
                    ))}
                    <Button variant="outline" disabled={textValue(selection.record['核查标记']) !== '正常'}
                      onClick={() => openEditor(
                        'followup', 'create', undefined, relatedDraft(selectionKind, selection, 'followup'),
                      )}>
                      {advancementBlocked(selectionKind, selection) ? '补录历史跟进' : '记录跟进'}
                    </Button>
                  </>
                )}
                {selectionKind === 'followup' && followupTarget(selection) && (
                  <Button variant="outline" onClick={() => {
                    const target = followupTarget(selection)!;
                    void detail({ id: target.id, record: {} }, target.kind);
                  }}>查看所属对象与当前计划</Button>
                )}
              </div>
              {selectionKind !== 'access' && textValue(selection.record['核查标记']) === '待核查' && (
                <p className="panel-note" role="status">当前记录待核查。请先核对资料并点击“核查通过”，再继续关联业务。</p>
              )}
              {selectionKind !== 'access' && recordReviewProblem(selectionKind, selection.record) && (
                <p className="panel-note" role="status">{recordReviewProblem(selectionKind, selection.record)}</p>
              )}
              {selectionKind === 'project' && textValue(selection.record['结束建议']) && (
                <p className="panel-note">已有结束建议，请在飞书原表核对并完成处理；提出建议不会自动改变终局。</p>
              )}
              <RecordDetails key={`${selectionKind}:${selection.id}`} record={selection.record} />
              <p className="panel-note">
                结束确认、归档与重开请在飞书原表管理，完成前请核对当前计划和历史记录。
              </p>
            </>
          )}
          </div>
          <div className="form-actions">
            <Button variant="outline" onClick={() => { detailVersion.current++; setSelection(null); }}>关闭详情</Button>
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
              ? editor.operation === 'create'
                ? `新建${labels[editor.kind]}`
                : editor.operation === 'edit'
                  ? `编辑${labels[editor.kind]}`
                  : editor.operation === 'progress'
                    ? '更新项目进展'
                  : editor.operation === 'plan'
                    ? '调整当前计划'
                    : editor.operation === 'review'
                      ? '核查通过'
                      : editor.operation === 'access'
                        ? '维护授权意向'
                        : '提出结束建议'
              : ''}
          </DialogTitle>
          <DialogDescription>
            {editor?.operation === 'create'
              ? '保存后写入飞书多维表格，并进入待核查。'
              : editor?.operation === 'edit'
                ? '修改已有资料，保存后重新核查；只更新本次改动，不覆盖历史建议或当前计划。'
                : editor?.operation === 'access'
                  ? '保存意向不会自动修改实际角色。'
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
          {editor?.operation === 'progress' && <p className="panel-note">暂停需填写原因，原计划保留；启动或恢复需确认当前行动与日期。更新后进入待核查。</p>}
          {editor?.operation === 'edit' && editor.kind === 'project' && draft['项目类型'] !== '销售机会' && (
            <p className="panel-note">切换为非销售类型时保留原有商务信息供核查，不新增商务金额；详情仍可查看历史值。</p>
          )}
            {editor?.operation === 'edit' && editor.row && (
              <div className="panel-note">
                正在编辑：{textValue(editor.row.record[titles[editor.kind]])}。
                客户或项目归属保持不变，当前计划请使用“调整当前计划”。
              </div>
            )}
            <fieldset className="form-grid" disabled={saving || uncertain}>
              {editor &&
                specs(editor)
                  .filter(showField)
                  .map((f) => (
                    <FieldInput
                      key={f.key}
                      field={editor.operation === 'progress' && draft['工作状态'] !== '暂停' &&
                        ['当前下一步行动', '下次跟进日期'].includes(f.key) ? { ...f, required: true } : f}
                      draft={draft}
                      onChange={set}
                      disabled={saving || uncertain}
                    />
                  ))}
              {editor?.operation === 'edit' && (
                <FieldInput
                  field={{ key: '修改说明', type: 'long', required: true }}
                  draft={{ 修改说明: editReason }}
                  onChange={(_, value) => setEditReason(String(value ?? ''))}
                />
              )}
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
                  '保存到飞书'
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
