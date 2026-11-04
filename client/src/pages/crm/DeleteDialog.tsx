import React, { useEffect, useRef, useState } from 'react';
import type { DeleteKind, DeletionPreview } from '@shared/api.interface';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ActionButton as Button } from './ActionButton';
import { api, SaveOutcomeUnknown } from '../../api/crm';
import './deletion.css';

const names = {customer:'客户', project:'项目', contact:'联系人', followup:'跟进记录'};
export function DeleteDialog({target,onClose,onChanged}: {
  target: {kind:DeleteKind;id:string} | {job:DeletionPreview}; onClose:()=>void; onChanged:()=>void;
}) {
  const [preview,setPreview] = useState<DeletionPreview|null>('job' in target ? target.job : null);
  const [busy,setBusy] = useState(!('job' in target));
  const [error,setError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(()=>{
    alive.current=true;
    if (!('job' in target)) api.deletionPreview(target.kind,target.id).then(value=>{if(alive.current)setPreview(value);})
      .catch((e:Error)=>{if(alive.current)setError(e.message);}).finally(()=>{if(alive.current)setBusy(false);});
    return ()=>{alive.current=false;};
  },[target]);
  const execute = async () => {
    if (!preview || running.current) return;
    running.current=true; setBusy(true); setError('');
    try {
      let next=preview;
      do {
        next=await api.deletionStep(next.id);
        if(!alive.current)return;
        setPreview(next); onChanged();
        if(next.status==='paused'){setError(next.message || '删除已暂停，可继续核对');break;}
      } while(next.status!=='complete');
    } catch(e:unknown) {
      if(alive.current) {
        setError(e instanceof SaveOutcomeUnknown?'删除结果暂未确认，请核对已删除数量后继续':e instanceof Error?e.message:'删除未完成');
        try { const next=await api.deletionInspect(preview.id); if(alive.current){setPreview(next);if(next.status==='complete')setError('');onChanged();} } catch { /* Keep durable job ID for retry. */ }
      }
    } finally {running.current=false;if(alive.current)setBusy(false);}
  };
  const started=!!preview && preview.status!=='preview';
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}>
    <DialogContent className="crm-dialog delete-dialog" aria-describedby="delete-description" showCloseButton={!busy}
      onInteractOutside={event=>event.preventDefault()}>
      <DialogHeader className="crm-dialog-header"><DialogTitle>{preview?.status==='complete'?'删除完成':`删除${preview?names[preview.kind]:'记录'}`}</DialogTitle></DialogHeader>
      <div className="crm-dialog-body">
        <p id="delete-description">{preview?`「${preview.name}」`:busy?'正在核对删除范围…':'未能读取删除范围'}</p>
        {preview?.summary&&<p className="delete-summary">{preview.summary}</p>}
        {preview&&<ul className="delete-counts">{(Object.keys(preview.counts) as (keyof DeletionPreview['counts'])[]).filter(key=>preview.counts[key]>0).map(key=><li key={key}>{names[key]}：{preview.counts[key]} 条</li>)}</ul>}
        {!!preview?.restoresPending&&preview.status!=='complete'&&<p className="delete-warning">删除后，{preview.restoresPending} 条之前的跟进将恢复为待跟进，并重新进入待办和通知。</p>}
        {preview?.status!=='complete'&&<p className="delete-warning">删除后无法恢复。</p>}
        {started&&<p role="status">已删除 {preview?.deleted} / {preview?.total} 条{busy?'，正在处理…':''}</p>}
        {error&&<p className="delete-warning" role="alert">{error}</p>}
      </div>
      <div className="form-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>{started?'关闭':'取消'}</Button>
        {preview&&preview.status!=='complete'&&<Button variant="destructive" disabled={busy} onClick={execute}>{busy?'正在删除…':started?'继续删除':preview.kind==='followup'?'删除跟进记录':`删除${names[preview.kind]}及关联数据`}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

export function PendingDeletions({onResume,revision}:{onResume:(job:DeletionPreview)=>void;revision:number}) {
  const [jobs,setJobs]=useState<DeletionPreview[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{let valid=true;api.deletionPending().then(value=>{if(valid){setJobs(value);setError('');}}).catch(()=>{if(valid)setError('未完成删除读取失败，请刷新重试');});return()=>{valid=false;};},[revision]);
  return <>{error&&<p role="alert">{error}</p>}{jobs.map(job=><div className="delete-pending" key={job.id}>未完成删除：{job.name}（已删除 {job.deleted}/{job.total}）<Button size="sm" variant="outline" onClick={()=>onResume(job)}>查看并继续</Button></div>)}</>;
}
