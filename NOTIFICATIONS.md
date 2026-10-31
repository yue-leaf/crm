# 每日待办通知

管理员在左侧「通知设置」配置开关、发送时间和企业内部接收人。默认每天 08:00，时区 Asia/Shanghai，发送时间支持 00:00 至 23:30、间隔半小时。每日包含周末。

内容复用工作台的客户/项目当前计划：今日与明日分组，每组最多列出 5 项，显示总数、行动和执行人，并提供对应筛选及详情链接。签约项目仍跟进，暂停项目有计划则纳入，取消项目不纳入。历史跟进建议不作为当前计划。两天都无事项时不发送。

## 架构与部署

- 官方插件 `@official-plugins/send-feishu-message@1.0.33`，实例 `crm-daily-notice`，服务端调用 `send_feishu_message`。
- 调用投影已通过本地 plugin-hydrate 获取：unary；输入必填 `recipients: string[]`（妙搭用户 ID）、`title: string`、`content: string`；输出 `success: boolean`。formValue 使用 bot、动态 receiverUserList、title 对象、正文，群和底部按钮为空。
- `crmDailyReminder` 云端 cron：`*/30 * * * *`，Asia/Shanghai。触发器保持启用，处理器读取持久化设置；修改时间无需重新发布或把 CLI 凭证放入服务端。
- 数据库 `crm_notification_setting` 保存唯一 daily 配置、版本和下次执行时间；`crm_notification_delivery` 保存执行及接收人明细。HTTP API 和表 RLS 均只允许真实 `crm_admin` 角色；系统自动化使用平台系统上下文。数据库不存机器人凭证。
- `recipient_ids` 保存消息路由的妙搭 ID 数组，不承担角色或授权功能。显示和选择使用平台 UserDisplay/UserSelect，保存时由服务端核对目录及飞书身份映射。
- 在另一企业部署时，先核对实际管理员角色，在开发环境运行 `server/database/notification.sql` 创建新表，再运行 `npm run gen:db-schema`。表结构发布完成后，在正式环境单独运行 `server/database/notification-seed.sql` 初始化配置，再由该企业管理员选择接收人并开启。不要复制本企业的人员记录。
- 在其他应用部署时配置服务端 `CRM_PUBLIC_URL` 为真实发布 URL；不配置时使用本正式应用 URL。
- 创建同名 cron（默认 disabled）→ 提交/推送代码 → 发布完成 → 启用并回读 enabled。cron 只运行已发布版本，不通过本机计时器运行。

### 环境初始化与发布核对

开发环境的配置数据不会随代码和表结构发布到正式环境。数据库命令必须明确指定 `--environment dev` 或 `--environment online`；省略参数时，多环境应用会默认操作开发环境。

在应用仓库目录执行以下命令，替换应用 ID 和登录配置名。开发环境需要初始化时用 `dev`；正式环境须在表结构发布后执行 `online`：

```powershell
lark-cli apps +db-execute --app-id <app_id> --environment online --file server/database/notification-seed.sql --yes --profile <profile> --as user --format json
```

脚本只补充缺失的 `daily` 配置，重复执行不会覆盖管理员已有设置。新企业默认关闭通知、接收人为空。每次上线核对正式环境存在这一行，并核对发送开关、时间、接收人及下一次执行时间后再启用 cron。不能用开发环境查询结果代替正式环境验收。

若界面提示「通知设置尚未初始化」，先检查正式环境是否缺少 `daily` 行；存在记录时再排查当前账号是否具有 `crm_admin` 角色以及对应表的 RLS。不要用放开全员权限解决配置缺失问题。

## 修改时间和可靠性

保存时按当前时刻计算下一次未来发送时间；已经过去的时间安排到翌日，不立即补发。当日同一接收人以 `daily:日期:用户ID` 唯一键领取任务，调整时间、进程重启及重复投递都不自动重复发送。当天新增接收人可以在新的未来发送时刻收到提醒。

读取业务数据失败最多重试 3 次、每次由后续半小时检查触发；不发送部分分页结果。超过发送时刻 2 小时或跨日则记录错过，不补发旧通知。读取领取有 20 分钟恢复阈值；发送前再次用条件更新领取发送权，配置变更时停止未发送部分。

发送前写入接收人唯一记录。调用返回 `success:true` 只显示「飞书已受理」，不表示用户已阅读。超时、异常或缺少成功回执显示「结果待确认」，不自动重发，避免重复消息。崩溃留下的 sending/dispatching 记录须结合日志和接收人的消息核对。

「发送测试给我」只向当前管理员发送，即使当前两天均无待办也可测试通道；不向配置列表中的其他人发送。测试有请求 ID 去重和一分钟频率限制，不占用每日通知的去重键。测试发送失败时先查看飞书及日志，勿重复点击。

## 验证

运行 `npm run precommit`（类型、lint、完整回归），前端使用 Node 22+ 运行 Vite production build。
新增通知测试覆盖时区/跨日、时间校验、实际工作台统计口径、卡片内容安全/长度、无待办、读失败、并发领取、配置变更、重复接收人、未知发送结果及管理员鉴权。

已发布界面可用「预览今日通知」「发送测试给我」核对；自动化是否启用以平台回读为准，是否真实按时运行以到点后的执行日志和通知明细为准。
