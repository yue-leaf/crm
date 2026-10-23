# Base 插件合同与验证

本应用使用 `@official-plugins/feishu-bitable@1.0.22`。五个实例来自现有 Base 真实表结构；插件输入由 `CrmService` 固定操作白名单生成，不接受前端传入表ID或action。

| action | 关键输入 | 响应 |
| --- | --- | --- |
| searchRecords | pageSize、pageToken、filter | records、hasMore、pageToken |
| getRecord | recordID | id、record |
| batchAddRecords | records: [{record}] | records: [{id}] |
| batchUpdateRecords | records: [{id,record}] | records: [{id}] |
| aggregateQuery | measures: [{fieldName,aggregation:'count',alias:'total'}] | result: [{total:{value}}] |

文本读取为 `{text}`、写入字符串；人员为妙搭数值ID数组，转换时必须拒绝不安全整数。关联读取为 `{link_record_ids}`，写入必须是记录ID字符串数组；不能把读取形状原样写回。日期为毫秒时间戳，界面日期按 Asia/Shanghai 解释。可选字段接受省略但当前插件不接受 null，因此不能用 null 清日期；终局确认等需要清空日期的业务动作保留原生入口。

合同来自实际安装包 schema projection 和真实 SDK 读写验证：2026-10-24 客户→联系人→项目→跟进创建、回读、核查、计划和结束建议均通过，4条临时记录已反向清理。该联调验证SDK/业务服务，不等同于线上浏览器登录验收。

权限：插件按应用所有者 Base 权限运行；`crm_admin` 来自可信请求上下文，不来自业务授权意向表。原始 capability/debug 控制器全局拒绝，避免绕过字段和关系校验。请求、响应正文日志关闭；HTTP错误不暴露内部堆栈。

更新开始检查客户端修改时间；人员/关系校验结束后，再读取目标记录并比较完整字段快照，同实例同记录更新互斥。但 Base 不提供原子CAS：最终检查到写入之间、跨实例以及关联记录自身仍存在竞争窗口。所有新建/更新均核对写入返回ID并逐字段回读，回读失败或不一致不报告成功。写请求无自动重试；网络超时或服务端5xx会锁定当前表单重提，提示先刷新核对。当前没有持久幂等键，不能承诺跨标签页重复提交恰好执行一次。

权限意向表的可选文本字段：明确提交空值写为空字符串，省略则保留。联系人/项目的所属企业必须唯一；历史停用联系人仅在状态为“停用”、停用时间有限且实际发生时间严格早于停用时间时接受，未知状态拒绝。校验核查记录时保留原始毫秒时间精度。业务服务日志仅记录插件操作名称，不打印上游错误原文。

## 日常编辑

`PATCH /api/crm/records/:kind/:id/edit` 接受 `{changes,reason,expectedModifiedAt}`，白名单来自shared/crm-edit。服务端读取当前记录后合并变更、重新校验必填/人员/关系/业务规则，仅更新变化字段并重置待核查、追加修改说明。保存后按字段回读比对，任何不一致均提示刷新核对；不自动重试。

所属企业、跟进归属及客户/项目关联不允许通过日常编辑修改，当前计划使用已有独立操作。终局、归档、记录状态和核查标记不接收客户端修改。已归档/结束/停用/作废记录不提供日常编辑。空文本写空字符串、空人员/联系人关联写数组；日期、数值、单选清空在调用插件前拒绝，避免假成功或保留旧值。
