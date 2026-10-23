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

更新前比较修改时间，但 Base 不提供原子CAS：存在检查到写入之间的竞争窗口。写请求无自动重试；网络超时提示先刷新核对。当前没有持久幂等键，不能承诺跨标签页重复提交恰好执行一次。
