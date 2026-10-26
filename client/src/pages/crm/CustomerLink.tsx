import React, { useEffect, useState } from 'react';
import { api } from '@/api/crm';
import { textValue } from '@shared/crm';

export const CustomerLink: React.FC<{ id: string; onOpen?: (id: string) => void }> = ({ id, onOpen }) => {
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let canceled = false;
    setName(''); setFailed(false);
    void api.get('customer', id).then(row => {
      if (!canceled) setName(textValue(row.record['企业全称']) || '未命名客户');
    }).catch(() => { if (!canceled) setFailed(true); });
    return () => { canceled = true; };
  }, [id, retry]);
  if (failed) return <button type="button" className="record-title" onClick={() => setRetry(n => n + 1)}>客户名称加载失败，重试</button>;
  return onOpen ? <button type="button" className="record-title" disabled={!name} onClick={() => onOpen(id)}>{name || '加载客户…'}</button>
    : <span>{name || '加载客户…'}</span>;
};
