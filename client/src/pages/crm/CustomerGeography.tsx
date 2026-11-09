import React, { useEffect, useMemo, useState } from 'react';
import { Copy, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CrmRecord, CustomerGeoData, EntityKind } from '@shared/api.interface';
import { geographyMatches } from '@shared/crm-geography';
import { regionCities } from '@shared/china-regions';
import { regionProvinces } from '@shared/crm-region';
import { ActionButton as Button } from './ActionButton';
import { Cell } from './Fields';
import './geography.css';

interface Props {
  data: CustomerGeoData | null; loading: boolean; busy: boolean;
  onView: (row: CrmRecord, kind: EntityKind) => void | Promise<void>;
  onContacts: (id: string) => void | Promise<void>;
  onProjects: (id: string) => void | Promise<void>;
}
const emptyCustomers: CustomerGeoData['customers'] = [];
export function CustomerGeography({ data, loading, busy, onView, onContacts, onProjects }: Props) {
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const customers = data?.customers || emptyCustomers;
  const groups = useMemo(() => {
    const result = new Map<string, { total: number; cities: Map<string, number> }>();
    for (const row of customers) {
      const key = row.province || '__missing__';
      const group = result.get(key) || { total: 0, cities: new Map<string, number>() };
      group.total++;
      const cityKey = row.city || '__missing__';
      group.cities.set(cityKey, (group.cities.get(cityKey) || 0) + 1);
      result.set(key, group);
    }
    return [...result].sort(([a], [b]) => a === '__missing__' ? 1 : b === '__missing__' ? -1 : a.localeCompare(b, 'zh-CN'));
  }, [customers]);
  const rows = customers.filter(row => geographyMatches(row, province, city, query));
  useEffect(() => { setLimit(20); }, [province, city, query, data]);
  const selectProvince = (value: string) => { setProvince(value); setCity(''); };
  const selectRegion = (value: string, selectedCity = '') => {
    setProvince(value); setCity(selectedCity); setSearch(''); setQuery('');
  };
  const copyPhone = async (phone: string) => {
    try { await navigator.clipboard.writeText(phone); toast.success('电话已复制'); }
    catch { toast.error('复制失败，请选中号码手动复制'); }
  };
  const open = (id: string, kind: EntityKind) => onView({ id, record: {} }, kind);
  return <section className="customer-geography" aria-label="客户地区分布" aria-busy={loading}>
    <form className="panel geography-filters" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}>
      <label>省份<Select value={province || '__all__'} onValueChange={value => selectProvince(value === '__all__' ? '' : value)}>
        <SelectTrigger aria-label="按省份筛选"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="__all__">全部省份</SelectItem>
          {regionProvinces.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          <SelectItem value="__missing__">待补充地区</SelectItem>
        </SelectContent></Select></label>
      <label>城市<Select value={city || '__all__'} disabled={!province || province === '__missing__'}
        onValueChange={value => setCity(value === '__all__' ? '' : value)}>
        <SelectTrigger aria-label="按城市筛选"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="__all__">全部城市</SelectItem>
          {(regionCities[province] || []).map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          <SelectItem value="__missing__">未填写城市</SelectItem>
        </SelectContent></Select></label>
      <label className="geography-query">客户 / 城市<Input aria-label="搜索客户或城市" value={search}
        onChange={event => setSearch(event.target.value)} placeholder="输入客户名称、省份或城市" /></label>
      <div className="geography-filter-actions"><Button type="submit" variant="outline">搜索</Button>
        <Button type="button" variant="secondary" onClick={() => selectRegion('')}>重置</Button></div>
    </form>
    <div className="geography-body">
      <aside className="panel geography-regions" aria-label="地区客户数量">
        <button type="button" aria-pressed={!province} onClick={() => selectRegion('')}>全部地区<span>{customers.length}</span></button>
        {groups.map(([name, group]) => <div key={name}>
          <button type="button" aria-pressed={province === name && !city} onClick={() => selectRegion(name)}>
            {name === '__missing__' ? '待补充地区' : name}<span>{group.total}</span>
          </button>
          {province === name && name !== '__missing__' && <div className="geography-cities">
            {[...group.cities].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([nameCity, count]) =>
              <button type="button" key={nameCity} aria-pressed={city === nameCity} onClick={() => selectRegion(name, nameCity)}>
                {nameCity === '__missing__' ? '未填写城市' : nameCity}<span>{count}</span>
              </button>)}
          </div>}
        </div>)}
      </aside>
      <div className="panel geography-results">
        <div className="geography-result-heading"><h2><MapPin size={17} />{province === '__missing__' ? '待补充地区' : city === '__missing__' ? `${province} · 未填写城市` : city || province || '全部地区'}</h2>
          <span>{loading ? '正在加载…' : data ? `共 ${rows.length} 家客户` : '数据暂不可用'}</span></div>
        {loading ? <div className="related-empty" role="status">正在读取客户分布…</div> : !data ? <div className="related-empty">数据加载失败，请点击刷新重试</div>
          : !rows.length ? <div className="related-empty">{customers.length ? '当前地区或搜索条件下暂无客户' : '暂无客户，创建后可在这里查看地区分布'}</div>
            : <div className="geography-table-scroll"><table className="geography-table"><thead><tr>
              <th>客户 / 地址</th><th>客户联系人</th><th>客户负责人</th><th>最近跟进</th><th>关联项目</th>
            </tr></thead><tbody>{rows.slice(0, limit).map(row => <tr key={row.id}>
              <td><button className="record-title" disabled={busy} onClick={() => open(row.id, 'customer')}>{row.name}</button>
                <div className="geography-address">{row.province ? [row.province, row.city !== row.province ? row.city : ''].filter(Boolean).join(' · ') : '待补充地区'}</div>
                {row.address && <div className="geography-address">{row.address}</div>}
                {row.province && !row.city && <small className="geography-muted">未填写城市</small>}</td>
              <td>{row.contacts.length ? <>{row.contacts.slice(0, 2).map(contact => <div className="geography-contact" key={contact.id}>
                <button disabled={busy} onClick={() => open(contact.id, 'contact')}>{contact.name}</button>
                {contact.phone && <div><span>{contact.phone}</span><button type="button" aria-label={`复制${contact.name}的电话`} onClick={() => void copyPhone(contact.phone)}><Copy size={12} /></button></div>}
                {!contact.phone && contact.email && <small>{contact.email}</small>}
              </div>)}{row.contacts.length > 2 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onContacts(row.id)}>全部 {row.contacts.length} 位联系人</Button>}</> : <span className="geography-muted">暂无有效联系人</span>}</td>
              <td>{row.owners.length ? <Cell name="客户负责人" value={row.owners} /> : <span className="geography-muted">未指定</span>}</td>
              <td>{row.latestFollowup ? <><Cell name="实际发生时间" value={row.latestFollowup.occurredAt} />
                <button className="geography-followup" disabled={busy} title={row.latestFollowup.conclusion}
                  onClick={() => open(row.latestFollowup!.id, 'followup')}>{row.latestFollowup.conclusion || '查看跟进详情'}</button></> : <span className="geography-muted">暂无有效跟进</span>}</td>
              <td><Button variant="ghost" size="sm" disabled={busy || !row.projectCount} onClick={() => onProjects(row.id)}>{row.projectCount} 个项目</Button></td>
            </tr>)}</tbody></table></div>}
        {data && !loading && rows.length > limit && <div className="geography-more"><span>已显示 {Math.min(limit, rows.length)} / {rows.length} 家</span>
          <Button variant="outline" size="sm" onClick={() => setLimit(value => value + 20)}>加载更多</Button></div>}
      </div>
    </div>
  </section>;
}
