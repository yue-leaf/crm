import { regionCities } from './china-regions';

export interface CustomerRegion { province: string; city: string; address: string }
export const regionProvinces: string[] = Object.keys(regionCities);
const provinceAliases: Record<string, string[]> = {
  内蒙古自治区: ['内蒙古'], 广西壮族自治区: ['广西'], 西藏自治区: ['西藏'],
  宁夏回族自治区: ['宁夏'], 新疆维吾尔自治区: ['新疆'],
  香港特别行政区: ['香港'], 澳门特别行政区: ['澳门'],
};
const aliases = (name: string): string[] => [name, ...(provinceAliases[name] ||
  (/[省市]$/.test(name) ? [name.slice(0, -1)] : []))];
const trimSeparator = (value: string): string => value.replace(/^[\s/,，、·-]+/, '');
const prefix = (text: string, names: string[]): { name: string; rest: string; length: number } | undefined => {
  for (const match of names.flatMap(name => aliases(name).map(alias => ({ name, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)) {
    if (text.startsWith(match.alias) && !(match.alias !== match.name && /^[路街道]/.test(text.slice(match.alias.length))))
      return { name: match.name, rest: trimSeparator(text.slice(match.alias.length)), length: match.alias.length };
  }
  return undefined;
};

/** Read legacy text without writing back; only unambiguous leading region names are recognized. */
export function parseCustomerRegion(raw: string): CustomerRegion {
  const text = raw.trim();
  const parts = raw.split(' / ');
  // Canonical format keeps an empty city slot so a street is never mistaken for a city.
  if (parts.length >= 3 && regionProvinces.includes(parts[0]) &&
    (!parts[1] || regionCities[parts[0]].includes(parts[1]))) {
    return { province: parts[0], city: parts[1], address: parts.slice(2).join(' / ') };
  }
  const province = prefix(text, regionProvinces);
  const candidates = regionProvinces.flatMap(name => {
    const city = prefix(text, regionCities[name]);
    return city ? [{ province: name, city: city.name, address: city.rest, length: city.length }] : [];
  });
  // e.g. 吉林市 is a city, while 吉林 / … denotes the province.
  if (candidates.length === 1 && (!province || candidates[0].length > province.length)) {
    const { province: matchedProvince, city, address } = candidates[0];
    return { province: matchedProvince, city, address };
  }
  if (province) {
    const city = prefix(province.rest, regionCities[province.name]);
    const soleCity = ['北京市', '天津市', '上海市', '重庆市', '香港特别行政区', '澳门特别行政区'].includes(province.name)
      ? regionCities[province.name][0] : '';
    return { province: province.name, city: city?.name || soleCity, address: city?.rest ?? province.rest };
  }
  return { province: '', city: '', address: raw };
}

/** Preserve the existing Base text field; never migrate or rewrite other customers. */
export function formatCustomerRegion(value: CustomerRegion): string {
  if (!value.province) return value.address;
  return `${value.province} / ${value.city} / ${value.address}`;
}
