# 客户与项目协作管理（CRM）

飞书妙搭全栈应用：React 界面 → NestJS 业务服务 → 飞书多维表格。Base 保存客户、联系人、项目、跟进和权限目录；妙搭数据库保存通知配置、发送去重、跟进并发控制和删除操作状态。

- 客户集中管理联系人，支持省市分布；项目关联客户。
- 跟进按沟通记录继续、结束和恢复，允许多人分别推进；支持原文件名附件上传。
- 工作台展示逾期、本周待跟进和待办；通知按管理员配置的时间每日发送。
- 普通企业员工使用业务功能；删除、权限配置和通知设置限管理员。权限目录登记不等于平台授权。

## 部署到另一企业

使用完整的 [独立部署说明](deploy/README.md)。[手工部署说明](deploy/MANUAL.md) 列出逐步配置和验收。

```powershell
powershell -File ./deploy.ps1 -Config ./deploy/tenants/company-b.json -Apply -Publish
```

先按说明准备目标账号和配置。部署会新建独立资源，不带走原企业数据或凭证。代码仓库和交付包都包含部署工具；旧的仓库外部署文档及 v42 等旧包不再作为当前版本入口。

## 开发与检查

需要 Node.js 22+。在目标妙搭应用独立初始化的工程内配置开发环境后运行：

```powershell
npm ci
npm run dev:local
npm run precommit
```

生产发布是提交 → 推送目标应用远端 → 妙搭发布 → 查询本轮 finished；不要把编辑器地址当正式使用地址。

通知说明见 [NOTIFICATIONS.md](NOTIFICATIONS.md)，附件说明见 [ATTACHMENTS.md](ATTACHMENTS.md)。
