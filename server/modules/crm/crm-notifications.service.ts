import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuthNPaasService, CapabilityService, DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { crmNotificationDelivery as deliveries, crmNotificationSetting as settings } from '../../database/schema';
import type { NotificationPreview, NotificationSettings, NotificationState } from '@shared/api.interface';
import { buildNotification, nextNotificationAt, notificationDay, validateNotificationSettings } from '@shared/crm-notifications';
import { CrmService } from './crm.service';

type Setting = typeof settings.$inferSelect;
type Delivery = typeof deliveries.$inferSelect;
// Deployment-specific URL, overridable when deploying to another enterprise.
const APP_URL = process.env.CRM_PUBLIC_URL || 'https://example.feishu.link/app/app_example000001';

@Injectable()
export class CrmNotificationsService {
  private readonly logger = new Logger(CrmNotificationsService.name);
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(CapabilityService) private readonly capability: CapabilityService,
    @Inject(AuthNPaasService) private readonly identities: AuthNPaasService,
    private readonly crm: CrmService,
  ) {}

  private async setting(): Promise<Setting> {
    const [row] = await this.db.select().from(settings).where(eq(settings.settingKey, 'daily')).limit(1);
    if (!row) throw new ConflictException('通知设置尚未初始化');
    return row;
  }

  private view(row: Setting): NotificationSettings {
    return { enabled: row.enabled, sendTime: row.sendTime, recipientIds: row.recipientIds,
      revision: row.revision, nextAt: row.nextAt.toISOString() };
  }

  async state(): Promise<NotificationState> {
    const row = await this.setting();
    const logs = await this.db.select().from(deliveries).orderBy(desc(deliveries.updatedAt)).limit(30);
    return { settings: this.view(row), logs: logs.map(item => ({ id: item.id, day: item.businessDay,
      recipientId: item.recipient, mode: item.mode, status: item.status, detail: item.detail,
      todayCount: item.todayCount, tomorrowCount: item.tomorrowCount, updatedAt: item.updatedAt.toISOString() })) };
  }

  async save(body: unknown, actorId: string): Promise<NotificationSettings> {
    const value = (() => { try { return validateNotificationSettings(body); }
      catch (e) { throw new BadRequestException(e instanceof Error ? e.message : '通知设置无效'); } })();
    if (value.recipientIds.length) {
      const users = await this.identities.listUsersByIds(value.recipientIds);
      if (users.length !== value.recipientIds.length || users.some(user => !user))
        throw new BadRequestException('接收人信息不可用，请重新选择本企业员工');
      const linked = await this.identities.getBatchLarkUserIds(value.recipientIds);
      if (linked.length !== value.recipientIds.length || linked.some(id => !id))
        throw new BadRequestException('接收人需要关联本企业飞书账号');
    }
    const now = new Date();
    const [row] = await this.db.update(settings).set({ enabled: value.enabled, sendTime: value.sendTime,
      recipientIds: value.recipientIds, nextAt: nextNotificationAt(value.sendTime, now.getTime()),
      revision: value.revision + 1, updatedAt: now, updatedBy: actorId,
    }).where(and(eq(settings.settingKey, 'daily'), eq(settings.revision, value.revision))).returning();
    if (!row) throw new ConflictException('设置已被修改，请刷新后重新保存');
    return this.view(row);
  }

  async preview(now = Date.now()): Promise<NotificationPreview> {
    return buildNotification(await this.crm.notificationTasks(now), now, APP_URL.replace(/\/$/, ''));
  }

  private async finish(id: string, status: string, detail: string, preview?: NotificationPreview): Promise<void> {
    await this.db.update(deliveries).set({ status, detail, updatedAt: new Date(),
      ...(preview ? { todayCount: preview.todayCount, tomorrowCount: preview.tomorrowCount } : {}),
    }).where(eq(deliveries.id, id));
  }

  private async deliver(key: string, recipient: string, mode: string, preview: NotificationPreview): Promise<void> {
    // Claim before the external side effect. Unknown outcomes are never automatically resent.
    const [claim] = await this.db.insert(deliveries).values({ deliveryKey: key, recipient,
      businessDay: preview.day, mode, status: 'sending', detail: '正在提交消息',
      todayCount: preview.todayCount, tomorrowCount: preview.tomorrowCount,
    }).onConflictDoNothing({ target: deliveries.deliveryKey }).returning();
    if (!claim) return;
    try {
      const result: unknown = await this.capability.load('crm-daily-notice').call('send_feishu_message', {
        recipients: [recipient], title: mode === 'test' ? `通知测试 · ${preview.day}` : preview.title,
        content: preview.content,
      });
      if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true)
        throw new Error('Message acknowledgement missing');
      await this.finish(claim.id, 'accepted', '飞书已受理', preview);
    } catch {
      this.logger.warn(`Notification outcome unknown: ${claim.id}`);
      await this.finish(claim.id, 'uncertain', '发送结果未确认，请先检查飞书消息，系统不会自动重发', preview);
    }
  }

  async test(actorId: string, key: unknown): Promise<NotificationState> {
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key)) throw new BadRequestException('测试请求标识无效');
    const [recent] = await this.db.select().from(deliveries)
      .where(eq(deliveries.mode, 'test')).orderBy(desc(deliveries.createdAt)).limit(1);
    if (recent && recent.deliveryKey !== `test:${actorId}:${key}` && Date.now() - recent.createdAt.getTime() < 60000)
      throw new BadRequestException('请稍后再发送测试，间隔至少一分钟');
    const preview = await this.preview();
    await this.deliver(`test:${actorId}:${key}`, actorId, 'test', preview);
    return this.state();
  }

  private async advance(config: Setting, now: number): Promise<void> {
    await this.db.update(settings).set({ nextAt: nextNotificationAt(config.sendTime, now) })
      .where(and(eq(settings.id, config.id), eq(settings.revision, config.revision), eq(settings.nextAt, config.nextAt)));
  }

  async run(now = Date.now()): Promise<void> {
    const config = await this.setting();
    if (!config.enabled || !config.recipientIds.length || now < config.nextAt.getTime()) return;
    const day = notificationDay(config.nextAt.getTime());
    const key = `run:${day}:${config.revision}`;
    const [inserted] = await this.db.insert(deliveries).values({ deliveryKey: key, businessDay: day,
      mode: 'scheduled', status: 'reading', detail: '读取今日和明日待办',
    }).onConflictDoNothing({ target: deliveries.deliveryKey }).returning();
    let claim: Delivery | undefined = inserted;
    if (!claim) {
      // Only retry data reads, at most three attempts. A stale pre-send read can be reclaimed.
      const [retried] = await this.db.update(deliveries).set({ status: 'reading',
        attempts: sql`${deliveries.attempts} + 1`, updatedAt: new Date(now),
      }).where(and(eq(deliveries.deliveryKey, key), lt(deliveries.attempts, 3),
        or(eq(deliveries.status, 'read_failed'), and(eq(deliveries.status, 'reading'),
          lt(deliveries.updatedAt, new Date(now - 20 * 60000)))))).returning();
      claim = retried;
    }
    if (!claim) {
      const [existing] = await this.db.select().from(deliveries).where(eq(deliveries.deliveryKey, key)).limit(1);
      if (existing && !['reading', 'dispatching'].includes(existing.status)) await this.advance(config, now);
      else if (existing && now - existing.updatedAt.getTime() > 2 * 3600000) {
        await this.finish(existing.id, 'uncertain', '任务执行中断，请核对接收人明细，系统不会自动重发');
        await this.advance(config, now);
      }
      return;
    }
    if (notificationDay(now) !== day || now - config.nextAt.getTime() > 2 * 3600000) {
      await this.finish(claim.id, 'missed', '已错过发送窗口，未补发过时通知');
      await this.advance(config, now); return;
    }
    let preview: NotificationPreview;
    try { preview = await this.preview(now); }
    catch {
      await this.finish(claim.id, 'read_failed', claim.attempts >= 3 ? '待办读取失败，已停止重试' : '待办读取失败，将在下次检查时重试');
      this.logger.warn('Daily notification data read failed');
      if (claim.attempts >= 3) await this.advance(config, now);
      return;
    }
    if (!preview.todayCount && !preview.tomorrowCount) {
      await this.finish(claim.id, 'empty', '今日和明日均无待办，未发送');
      await this.advance(config, now); return;
    }
    // Transition atomically before sending; crashed sends stay visibly unresolved.
    const [claimed] = await this.db.update(deliveries).set({ status: 'dispatching', updatedAt: new Date() })
      .where(and(eq(deliveries.id, claim.id), eq(deliveries.status, 'reading'), eq(deliveries.attempts, claim.attempts))).returning();
    if (!claimed) return;
    for (const recipient of config.recipientIds) {
      const current = await this.setting();
      if (!current.enabled || current.revision !== config.revision) {
        await this.finish(claim.id, 'stopped', '设置已变更，停止本次尚未发送的消息', preview); return;
      }
      await this.deliver(`daily:${day}:${recipient}`, recipient, 'daily', preview);
    }
    await this.finish(claim.id, 'complete', '本次处理结束，接收人结果见明细', preview);
    await this.advance(config, now);
    this.logger.log(`Daily notification processed for ${day}`);
  }
}
