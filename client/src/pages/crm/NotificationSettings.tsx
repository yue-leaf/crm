import { loadEmployeeOptions } from './employeeOptions';
import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { UserSelect } from '../../components/business-ui/user-select';
import { ActionButton as Button } from './ActionButton';
import { api } from '../../api/crm';
import type { NotificationPreview, NotificationSettings as Settings, NotificationState } from '@shared/api.interface';
import { notificationTimes } from '@shared/crm-notifications';
import './notifications.css';

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
          <div className="notice-toggle"><div><strong>每日跟进简报</strong><p>每天向已启用成员发送本人的逾期、今日、明日和其他待跟进事项，全部为 0 也照常发送。其他包含后天起的事项和未安排日期的事项。</p></div>
            <Switch checked={draft.enabled} disabled={!!busy} aria-label="开启每日跟进简报" onCheckedChange={enabled => setDraft({ ...draft, enabled })} /></div>
          <div className="notice-fields">
            <div><label id="notice-time-label">发送时间</label><Select value={draft.sendTime} disabled={!!busy} onValueChange={sendTime => setDraft({ ...draft, sendTime })}>
              <SelectTrigger aria-labelledby="notice-time-label"><SelectValue /></SelectTrigger><SelectContent>{notificationTimes.map(time => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent>
            </Select><small>每天 · 中国时区 · 每半小时可选</small></div>
            <div><label>启用提醒的成员</label><UserSelect triggerType="search" loadOnOpen loadOptions={loadEmployeeOptions} className="crm-person-picker"
              classNames={{ trigger: 'crm-person-trigger', popover: 'crm-person-popover' }}
              slotProps={{ popover: { collisionPadding: 12 } }} value={draft.recipientIds} multiple disabled={!!busy} placeholder="选择本企业接收人" onChange={recipientIds => setDraft({ ...draft, recipientIds })} /></div>
          </div>
          <p className="notice-next">{dirty ? '修改后请保存。当日已经发送过的接收人不会重复收到提醒。'
            : state?.settings.enabled ? `下次发送：${dateText(state.settings.nextAt)}` : '提醒已关闭'}</p>
          <div className="notice-actions"><Button disabled={!!busy || !dirty || (draft.enabled && !draft.recipientIds.length)} onClick={() => void perform('save', async () => {
            const saved = await api.notificationSave(draft); setDraft(saved); setState(value => value ? { ...value, settings: saved } : value); toast.success('通知设置已保存');
          })}>{busy === 'save' ? '保存中…' : '保存设置'}</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => void perform('preview', async () => setPreview(await api.notificationPreview()))}>预览我的简报</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => void perform('test', async () => {
              testId.current ||= crypto.randomUUID();
              const sent = await api.notificationTest(testId.current);
              if (sent?.status === 'accepted') { toast.success('测试消息已提交飞书，仅发送给当前账号'); testId.current = null; }
              else setError(sent?.detail || '发送结果暂未确认，请先检查飞书消息，避免重复发送');
            })}>发送测试给我</Button></div>
          {preview && <section className="notice-preview"><h3>{preview.title}</h3><p>当前账号的待跟进事项</p>
            <p className="notice-preview-text">{preview.content.replace(/<person ids="[0-9,]+">/g, '已指定员工').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}</p></section>}
        </>}
      </div>
      <div className="form-actions"><Button variant="outline" disabled={!!busy} onClick={onClose}>关闭</Button></div>
    </DialogContent>
  </Dialog>;
};
