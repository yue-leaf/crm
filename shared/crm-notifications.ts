import type { NotificationPreview, NotificationSettingsUpdate } from './api.interface';
import type { WorkspaceTask } from './crm-workspace';

const DAY = 86400000;
const OFFSET = 28800000;
export const notificationTimes: string[] = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export const notificationDay = (now: number): string => new Date(now + OFFSET).toISOString().slice(0, 10);

/** Always schedule the next future occurrence; changing a past time never sends immediately. */
export function nextNotificationAt(time: string, now: number): Date {
  if (!notificationTimes.includes(time)) throw new Error('请选择半小时为单位的发送时间');
  const [hour, minute] = time.split(':').map(Number);
  const today = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET + (hour * 60 + minute) * 60000;
  return new Date(today > now ? today : today + DAY);
}

export function validateNotificationSettings(value: unknown): NotificationSettingsUpdate {
  if (!value || typeof value !== 'object') throw new Error('通知设置无效');
  const v = value as Record<string, unknown>;
  if (typeof v.enabled !== 'boolean' || typeof v.sendTime !== 'string' || !notificationTimes.includes(v.sendTime))
    throw new Error('请选择发送时间，精度为半小时');
  if (!Array.isArray(v.recipientIds) || v.recipientIds.length > 20 ||
    !v.recipientIds.every((id: unknown) => typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id)))
    throw new Error('请选择有效的企业内部接收人，最多20人');
  if (v.enabled && !v.recipientIds.length) throw new Error('请先选择接收人');
  if (typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1)
    throw new Error('设置版本无效，请刷新');
  return { enabled: v.enabled, sendTime: v.sendTime, recipientIds: [...new Set(v.recipientIds as string[])], revision: v.revision };
}

// Do not let customer-entered text become card markup, mentions, or image uploads.
export function noticeText(value: string, max = 90): string {
  let escaped = '';
  for (const character of value.replace(/[\r\n\t]/g, ' ')) {
    const next = character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;'
      : /[\\`*_\[\](){}!#|]/.test(character) ? `\\${character}` : character;
    if (escaped.length + next.length > max) return escaped + '…';
    escaped += next;
  }
  return escaped;
}

export function buildNotification(tasks: WorkspaceTask[], now: number, appUrl: string): NotificationPreview {
  const day = notificationDay(now);
  const today = tasks.filter(row => row.due !== null && notificationDay(row.due) === day);
  const tomorrow = tasks.filter(row => row.due !== null && notificationDay(row.due) === notificationDay(now + DAY));
  const section = (name: string, rows: WorkspaceTask[], filter: string): string => {
    const lines = rows.slice(0, 5).map(row => {
      const target = row.kind === 'project' ? `${noticeText(row.name, 45)} · ${noticeText(row.customerName, 35)}` : noticeText(row.name, 70);
      const url = `${appUrl}/crm/${row.kind}?record=${encodeURIComponent(row.id)}`;
      const people = row.people.filter(id => /^[1-9]\d{0,18}$/.test(id));
      return `• [${target}](${url})\n  ${noticeText(row.action || '待补充下一步行动')}\n  执行人：${people.length ? `<person ids="${people.slice(0, 3).join(',')}">` : '未指定'}`;
    });
    return `**${name} · ${rows.length} 项**\n${lines.length ? lines.join('\n') : '暂无待处理事项'}${rows.length > 5 ? `\n还有 ${rows.length - 5} 项` : ''}\n[查看${name}全部事项](${appUrl}/?taskFilter=${filter}&scope=all)`;
  };
  return { day, todayCount: today.length, tomorrowCount: tomorrow.length,
    title: `待处理事项 · ${day}`, content: [section('今日', today, 'today'), section('明日', tomorrow, 'tomorrow')].join('\n\n') };
}
