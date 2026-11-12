# 另一企业独立部署 CRM

本目录是当前部署入口。适用于**使用另一账号，在另一飞书企业创建独立的一套 CRM**；不迁移原企业客户、联系人、项目、跟进、人员、通知历史或凭证。不用于覆盖现有正式系统，也不负责把旧版本原地升级。

## 交付内容与边界

- `deploy.ps1`：Windows 统一入口，默认纯预览。
- `deploy/run.mjs`、`engine.mjs`：目标身份核验、空白 Base、权限、独立妙搭应用、构建与发布。
- `deploy/runtime.mjs`：四张应用数据库表、通知初始设置、附件配置检查、通知插件/定时器与正式链接。
- `deploy/blueprint.json`：五张 Base 表的字段、关联、公式、视图、协作概览纯结构。它是部署结构的权威文件，不包含业务记录。
- `deploy/tenants/company-b.example.json`：非敏感配置模板。
- `deploy/build-package.mjs`：从当前已提交 Git 版本打包；交付对象不需要原仓库权限。
- `deploy/MANUAL.md`：手工部署顺序和验收清单。

脚本可自动创建与配置资源，但目标账号登录、平台授权/审批、目标多维表格附件授权码不能由源账号代办。首次执行可能在这些步骤暂停；完成后执行同一命令继续，不必从头部署。附件仅检查配置项存在，实际有效性需要上传验收。

仓库和交付包中的原表地址、数据源 ID 与平台应用 ID 均为示例值，脚本会使用新建目标资源重新生成，不会连接任何原企业。

## 1. 准备环境和目标账号

安装 Node.js 22 或更新版本、npm、Git、tar、PowerShell，以及支持本目录所用命令的 lark-cli（本次核对 1.0.98）。联网需要能访问飞书、妙搭 Git、npm 服务。

```powershell
node --version
npm --version
git --version
tar --version
lark-cli --version
lark-cli config --help
lark-cli auth login --help
```

使用目标企业的 CLI 应用配置建立独立 profile，例如 `company-b`，再用目标企业部署管理员登录该 profile。不要复用源企业 profile 的身份。CLI 应用 ID（`cli_...`）、妙搭应用 ID（`app_...`）、企业编号和 `tenant_key` 是不同标识。

需要目标企业允许创建 Base 和妙搭全栈应用，账号有创建、管理权限。脚本先检查所需命令，再核验登录用户、CLI App ID、`user_info.tenant_key`；任一不符就停止。平台提示缺少 scope 时，按具体返回完成目标应用授权，之后重跑。不要从源机器复制 OAuth 缓存。

## 2. 填写配置

在项目根目录或交付包根目录执行：

```powershell
Copy-Item deploy/tenants/company-b.example.json deploy/tenants/company-b.json
powershell -File ./deploy.ps1 -Config ./deploy/tenants/company-b.json -InspectIdentity
```

先将配置的 `profile` 改为目标 profile。只读命令输出当前 `expectedCliAppId`、`expectedUserOpenId`、`expectedTenantKey` 和用户名，将它们填回配置，并核对确实是目标企业账号。

| 配置 | 含义 |
| --- | --- |
| deploymentKey | 本次部署唯一标识，例如 company-b-crm；不同企业不能共用 |
| profile | 目标账号的 CLI profile |
| expectedEnterpriseDisplayId | 人工核对的企业编号，仅作标签，不能代替 tenant_key |
| expectedTenantKey | 真实目标企业 tenant_key，脚本严格校验 |
| expectedCliAppId / expectedUserOpenId | 目标 CLI 应用和部署用户；不是源企业 ID |
| appName | 新应用名称 |
| sourceCommit | 固定完整 Git SHA；交付包已填其实际版本，不要改成 HEAD |
| accessMode | tenant：企业已登录成员；admin-only：仅管理员；specified-members：管理员及指定员工 |
| employeeOpenIds | specified-members 使用，目标 CLI 应用下员工 Open ID |
| memberQueries | 可选姓名关键词，用于初始化权限配置中的人员目录，不授予角色 |
| timeZone | Asia/Shanghai |
| releaseReason | 本次发布说明 |

不允许在 JSON 里添加 Token、Secret、数据库连接串。正式配置、部署状态和交付产物均已加入 Git 忽略规则。

## 3. 预览与一条命令部署

```powershell
# 纯预览：不登录、不执行外部进程、不创建远端资源
powershell -File ./deploy.ps1 -Config ./deploy/tenants/company-b.json

# 实际创建、构建和发布
powershell -File ./deploy.ps1 -Config ./deploy/tenants/company-b.json -Apply -Publish
```

若 PATH 中 Node 版本较旧，可增加 `-NodePath "C:/path/to/node.exe"`。

脚本会：

1. 核对目标身份和固定源码版本。
2. 创建全新空白 Base、企业客户/联系人/项目/跟进/权限配置五张表、关联和视图。
3. 配置 Base 权限、登记目标部署管理员及指定人员。原表不直接开放给普通员工。
4. 创建全栈妙搭应用，配置 `crm_admin` 及指定访问范围；普通员工可以业务操作，删除和权限管理仍限管理员。
5. 创建独立代码目录，用目标 Base/表/字段重新生成五个数据源，安装多维表格和发送消息插件，生成通知实例。
6. 在 dev 和 online 分别执行同一份新增数据库初始化事务，校验字段类型、非空、唯一约束、RLS/策略存在；补齐 daily 设置，默认关闭且收件人为空。只初始化四张 CRM 表，不调用整库迁移，不覆盖其他待迁移结构。单环境旧应用不在本工具支持范围。
7. 创建 `crmDailyReminder` 定时器（初始禁用），检查线上附件授权配置。
8. 执行安装、lint、服务端构建、业务回归、前端生产构建；提交到目标应用 Git 并核对远端 SHA。
9. 发布并等待本轮完成，取得平台实际正式地址，设置 dev/online 的 `CRM_PUBLIC_URL`；再次发布使配置生效。两轮发布均保留 ID，续跑不会重复创建。
10. 最终发布完成后启用半小时检查定时器。管理员在通知设置选择收件人和时间后启用每日发送；部署脚本本身不发测试消息。

**附件配置暂停时**：脚本会给出目标 `app_...`。在目标账号有权限的多维表格中获取自定义插件授权码，在目标妙搭应用的**线上服务端环境变量**设置：

- Key：`FEISHU_BASE_PERSONAL_TOKEN`
- Value：目标账号获得的授权码

该账号必须能读写新建 Base 及附件。不要使用源企业授权码；不要将值写入 Git 或部署 JSON。本地预览/开发需要上传时，同样配置 dev 环境。配置后重跑部署命令。授权码失效时在对应环境轮换并重新发布。

## 4. 结果与验收

查看 `deploy/.state/<deploymentKey>/report.json`：记录目标 Base、应用 ID、两轮 release ID、最终提交和正式 URL。只有 `status=finished` 才表示发布流程完成；prepared 仅表示已推送，publishing/awaiting-approval/failed/blocked 都不算上线完成。

管理员验收：创建客户和联系人 → 新建项目（含首次跟进）→ 上传带中文名称的附件 → 查看/下载原文件 → 继续/结束/恢复跟进 → 管理员删除确认。另用普通成员检查能访问业务、不能管理权限或删除。确认客户/项目/跟进起始为空，创建数据只出现在新 Base。

通知验收：通知设置可以打开；选择目标企业成员、发送时间并启用；由管理员自行点击“发送测试给我”验证机器人和链接，再核对下次定时发送。每天四组（逾期/今日/明日/其他）均展示数量，包括 0；后台发送记录仅保留最近七天，页面不展示历史列表。定时器用于读取设置，修改发送时间无需改 cron。

将 `report.json` 的正式 URL 分发给已授权员工。妙搭编辑地址不是使用入口。需要飞书工作台入口时，由目标企业在自建应用中配置该正式 URL、可用范围并发布企业应用；这一步不由本脚本自动创建飞书开放平台应用。

## 5. 中断和恢复

- 保留整个 `.state/<deploymentKey>`，配置和版本不变时重跑同一命令。不要随意改 deploymentKey，否则会新建另一套。
- 平台高风险配置需确认时，终端会展示具体操作；非交互执行会生成 `pending-approval.json`。核对后使用提示的 `-ApproveAction <hash>` 继续。
- 超时导致创建结果不确定时，不盲目重试。先核对远端，再按错误中的 `-RetryAction <hash>` 明确恢复；Base/应用创建响应丢失可用 `-AdoptBaseToken` / `-AdoptAppId` 接回**本次已创建的同名资源**，不能接管现有正式系统。
- 数据库初始化有事务且可重复执行；已存在的 daily 设置不会被关闭、改时间或清空接收人。字段/权限缺失等结构异常会停止，需独立排查，不自动删表重建。
- 发布审批需目标企业管理员在平台处理；处理后续跑会查询原 release ID。发布失败不自动新建发布，先排查平台日志。
- `run.lock` 表示有进程运行。仅在确认进程已退出后人工移除，不要同时运行两份。
- 回滚新部署：先禁用定时器并限制新应用访问；保留目标资源和状态供检查。本工具不删除新应用/Base，不碰旧企业数据。后续版本升级需独立计划，不套用首次部署脚本。

## 6. 维护者交付与验证

```powershell
# 在源码仓库根目录；必须先提交改动
node deploy/build-package.mjs
# 将输出目录压缩并交付；不要打包整个工作目录或 .state
# 独立部署回归（不连飞书）
node --test deploy/tests/deployment.test.mjs deploy/tests/runtime.test.mjs
# 全量检查含部署回归
npm run precommit
```

包中包含运行代码归档和部署工具，排除源 `.spark`、`.spark_project`、`.npmrc`、`.env*`、源数据源实例、业务导出及部署状态。公开代码中的源 Base 链接会在准备目标工程时替换，通知默认源链接会移除。源 Git 历史不随包交付。

`package-checksums.json` 和 `source-manifest.json` 用于发现传输损坏/误改，不是数字签名。收到包后只复制示例配置为新 JSON 并编辑副本，不修改工具/模板/归档。脚本在应用前校验包文件。

本次验证范围：本地模拟部署、断点恢复、身份/权限漂移、附件配置缺失、两轮发布、结构生成及包校验；**尚未在另一真实企业完整执行**。真实企业的套餐、平台审批、附件授权和机器人可用范围必须按上面的验收确认。
