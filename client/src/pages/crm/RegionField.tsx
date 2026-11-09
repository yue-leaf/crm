import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { regionCities } from '@shared/china-regions';
import { formatCustomerRegion, parseCustomerRegion, regionProvinces } from '@shared/crm-region';
import type { CustomerRegion } from '@shared/crm-region';

export function RegionField({ value, onChange, disabled, id }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; id: string;
}) {
  const [region, setRegion] = useState(() => parseCustomerRegion(value));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setRegion(parseCustomerRegion(value)); }
  }, [value]);
  const change = (next: CustomerRegion) => {
    setRegion(next); emitted.current = formatCustomerRegion(next); onChange(emitted.current);
  };
  const cities = regionCities[region.province] || [];
  return <div className="customer-region-field">
    <div><label htmlFor={id}>省份</label><Select value={region.province || '__none__'} disabled={disabled}
      onValueChange={(province) => change({ ...region,
        province: province === '__none__' ? '' : province,
        city: regionCities[province]?.length === 1 ? regionCities[province][0] : '' })}>
      <SelectTrigger id={id}><SelectValue placeholder="请选择省份" /></SelectTrigger>
      <SelectContent><SelectItem value="__none__">未填写</SelectItem>
        {regionProvinces.map(province => <SelectItem key={province} value={province}>{province}</SelectItem>)}
      </SelectContent>
    </Select></div>
    <div><label htmlFor={`${id}-city`}>城市</label><Select value={region.city || '__none__'} disabled={disabled || !cities.length}
      onValueChange={(city) => change({ ...region, city: city === '__none__' ? '' : city })}>
      <SelectTrigger id={`${id}-city`}><SelectValue placeholder="请选择城市" /></SelectTrigger>
      <SelectContent><SelectItem value="__none__">未填写</SelectItem>
        {cities.map(city => <SelectItem key={city} value={city}>{city}</SelectItem>)}
      </SelectContent>
    </Select></div>
    <div className="region-address"><label htmlFor={`${id}-address`}>详细地址</label>
      <Input id={`${id}-address`} value={region.address} disabled={disabled} placeholder="区县、街道、门牌等"
        onChange={event => change({ ...region, address: event.target.value })} />
    </div>
    {!region.province && value.trim() && <p className="region-unresolved">原地区信息已保留，可选择省市补充。</p>}
  </div>;
}
