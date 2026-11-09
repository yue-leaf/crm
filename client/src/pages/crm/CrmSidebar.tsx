import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, Building2, FolderKanban, LayoutDashboard, MessageSquareText,
  PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { EntityKind } from '@shared/api.interface';
import { sectionLabels } from '@shared/crm';
import './sidebar.css';

const storageKey = 'crm.sidebar.collapsed';
const entries: { key: EntityKind | 'home'; label: string; icon: LucideIcon }[] = [
  { key: 'home', label: '工作台', icon: LayoutDashboard },
  { key: 'customer', label: sectionLabels.customer, icon: Building2 },
  { key: 'project', label: sectionLabels.project, icon: FolderKanban },
  { key: 'followup', label: sectionLabels.followup, icon: MessageSquareText },
  { key: 'access', label: sectionLabels.access, icon: ShieldCheck },
];

interface Props {
  active: EntityKind | 'home';
  admin: boolean;
  onNavigate: (page: EntityKind | 'home') => void;
  onNotifications: () => void;
}

export function CrmSidebar({ active, admin, onNavigate, onNotifications }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem(storageKey) === 'true'; }
    catch { return false; }
  });
  const toggle = () => {
    const next: boolean = !collapsed;
    setCollapsed(next);
    // Storage can be unavailable in embedded browsers; navigation must still work.
    try { window.localStorage.setItem(storageKey, String(next)); } catch { /* Use session state. */ }
  };
  const toggleLabel: string = collapsed ? '展开菜单' : '收起菜单';
  return <aside className={`crm-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="主导航">
    <div className="sidebar-heading">
      <div className="brand">
        <span><Building2 size={23} aria-hidden="true" /></span>
        <div className="sidebar-brand-text">客户与项目<b>协作管理</b></div>
      </div>
      <Tooltip><TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="sidebar-toggle" onClick={toggle}
          aria-label={toggleLabel} aria-expanded={!collapsed} aria-controls="crm-navigation">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </Button>
      </TooltipTrigger><TooltipContent side="right">{toggleLabel}</TooltipContent></Tooltip>
    </div>
    <div className="nav-caption">协作空间</div>
    <nav id="crm-navigation" aria-label="功能菜单">
      {entries.filter(entry => entry.key !== 'access' || admin).map(({ key, label, icon: Icon }) =>
        <Tooltip key={key}><TooltipTrigger asChild>
          <Button variant="ghost" className={active === key ? 'selected' : ''}
            aria-label={label} aria-current={active === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
            <Icon size={18} aria-hidden="true" /><span className="sidebar-nav-label">{label}</span>
          </Button>
        </TooltipTrigger>{collapsed && <TooltipContent side="right">{label}</TooltipContent>}</Tooltip>)}
      {admin && <Tooltip><TooltipTrigger asChild>
        <Button variant="ghost" aria-label="通知设置" onClick={onNotifications}>
          <Bell size={18} aria-hidden="true" /><span className="sidebar-nav-label">通知设置</span>
        </Button>
      </TooltipTrigger>{collapsed && <TooltipContent side="right">通知设置</TooltipContent>}</Tooltip>}
    </nav>
    <div className="sidebar-bottom"><ShieldCheck size={16} /> 企业数据 · 飞书连接
      <p>让每一次协作，都有下一步。</p>
    </div>
  </aside>;
}
