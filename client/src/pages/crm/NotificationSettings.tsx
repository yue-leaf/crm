import { loadEmployeeOptions } from './employeeOptions';
import React, { useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { UserSelect } from '../../components/business-ui/user-select';
import { UserDisplay } from '../../components/business-ui/user-display';
import { ActionButton as Button } from './ActionButton';
import { api } from '../../api/crm';
import type { NotificationPreview, NotificationSettings as Settings, NotificationState } from '@shared/api.interface';
import { notificationTimes } from '@shared/crm-notifications';
import './notifications.css';

const statusLabels: Record<string, string> = { reading: '读取待办', read_failed: '读取失败', dispatching: '发送处理中',
  sending: '结果待确认', accepted: '飞书已受理', uncertain: '结果待确认', empty: '无待办', complete: '已处理', stopped: '已停止', missed: '错过发送时间' };
const dateText = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export const NotificationSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [state, setState] = useState<NotificationState | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [preview, setPreview] = useState<NotificationPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('loading');
  const busyRef = useRef(false);
  const testId = useRef<string | null>(null);
  useEffect(() => {
    let canceled = false;
    api.notificationState().then(value => { if (!canceled) { setState(value); setDraft(value.settings); } })
      .catch((e: Error) => { if (!canceled) setError(e.message); })
      .finally(() => { if (!canceled) setBusy(''); });
    return () => { canceled = true; };
  }, []);
  const perform = async (key: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const refresh = () => perform('refresh', async () => {
    const value = await api.notificationState(); setState(value); setDraft(value.settings);
  });
  const dirty = !!draft && !!state && (draft.enabled !== state.settings.enabled || draft.sendTime !== state.settings.sendTime ||
    JSON.stringify(draft.recipientIds) !== JSON.stringify(state.settings.recipientIds));
  return <Dialog open onOpenChange={open => { if (!open && !busyRef.current) onClose(); }}>
    <DialogContent className="crm-dialog notice-dialog" aria-describedby={undefined}>
      <DialogHeader className="crm-dialog-header"><DialogTitle><Bell size={20} />通知设置</DialogTitle></DialogHeader>
      <div className="crm-dialog-body notice-body">
        {error && <div role="alert" className="notice-error">{error}<Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void refresh()}>刷新配置</Button></div>}
        {!draft && !error && <p role="status">正在加载设置…</p>}
        {draft && <>
          <div className="notice-toggle"><div><strong>每日待办提醒</strong><p>汇总全部客户和项目的今日、明日待处理事项。无待办时不发送。</p></div>
            <Switch checked={draft.enabled} disabled={!!busy} aria-label="开启每日待办提醒" onCheckedChange={enabled => setDraft({ ...draft, enabled })} /></div>
          <div className="notice-fields">
            <div><label id="notice-time-label">发送时间</label><Select value={draft.sendTime} disabled={!!busy} onValueChange={sendTime => setDraft({ ...draft, sendTime })}>
              <SelectTrigger aria-labelledby="notice-time-label"><SelectValue /></SelectTrigger><SelectContent>{notificationTimes.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent>
            </Select><small>每天 · 中国时区 · 每半小时可选</small></div>
            <div><label>接收人</label><UserSelect triggerType="search" loadOnOpen loadOptions={loadEmployeeOptions} className="crm-person-picker"
              classNames={{ trigger: 'crm-person-trigger', popover: 'crm-person-popover' }}
              slotProps={{ popover: { collisionPadding: 12 } }} value={draft.recipientIds} multiple disabled={!!busy} placeholder="选择本企业接收人" onChange={recipientIds => setDraft({ ...draft, recipientIds })} /></div>
          </div>
          <p className="notice-next">{dirty ? '修改后请保存。当日已经发送过的接收人不会重复收到提醒。'
            : state?.settings.enabled ? `下次发送：${dateText(state.settings.nextAt)}` : '提醒已关闭'}</p>
          <div className="notice-actions"><Button disabled={!!busy || !dirty || (draft.enabled && !draft.recipientIds.length)} onClick={() => void perform('save', async () => {
            const saved = await api.notificationSave(draft); setDraft(saved); setState(value => value ? { ...value, settings: saved } : value); toast.success('通知设置已保存');
          })}>{busy === 'save' ? '保存中…' : '保存设置'}</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => void perform('preview', async () => setPreview(await api.notificationPreview()))}>预览今日通知</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => void perform('test', async () => {
              testId.current ||= crypto.randomUUID();
              const value = await api.notificationTest(testId.current); setState(value);
              const sent = value.logs.find(log => log.mode === 'test');
              if (sent?.status === 'accepted') { toast.success('测试消息已提交飞书，仅发送给当前账号'); testId.current = null; }
              else setError(sent?.detail || '请核对下方发送记录，避免重复发送');
            })}>发送测试给我</Button></div>
          {preview && <section className="notice-preview"><h3>{preview.title}</h3><p>今日 {preview.todayCount} 项 · 明日 {preview.tomorrowCount} 项</p>
            <p className="notice-preview-text">{preview.content.replace(/<person ids="[0-9,]+">/g, '已指定员工').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}</p></section>}
          <div className="notice-log-heading"><h3>最近发送记录</h3><Button variant="ghost" size="sm" disabled={!!busy || dirty} onClick={() => void refresh()}><RefreshCw size={14} />刷新</Button></div>
          {!state?.logs.length ? <p className="notice-empty">暂无发送记录</p> : <div className="notice-logs">{state.logs.map(log => <article key={log.id}>
            <div><strong>{statusLabels[log.status] || '待核对'}</strong><span>{log.mode === 'test' ? '测试' : '每日提醒'}</span><time>{dateText(log.updatedAt)}</time></div>
            {log.recipientId && <UserDisplay userId={log.recipientId} />}<p>{log.detail}</p>
          </article>)}</div>}
        </>}
      </div>
      <div className="form-actions"><Button variant="outline" disabled={!!busy} onClick={onClose}>关闭</Button></div>
    </DialogContent>
  </Dialog>;
};
