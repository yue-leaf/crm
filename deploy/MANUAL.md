# 手工部署清单（独立企业）

推荐使用 [自动部署入口](README.md)，它会逐步核对返回结果并可续跑。本篇供需要人工控制流程的管理员使用。仅复制页面不能部署完整 CRM；必须同时准备 Base、角色、数据库、插件、附件授权和定时器。

## 资源及配置对照

| 项目 | 必须属于目标企业 | 来源/初始化 |
| --- | --- | --- |
| 飞书登录、CLI profile | 是 | 目标部署管理员登录 |
| Base 与五张表 | 是 | deploy/blueprint.json 的纯结构 |
| 妙搭 full_stack 应用 | 是 | 目标账号创建 |
| crm_admin 角色 | 是 | 目标部署管理员 |
| 可见范围 | 是 | tenant 或指定成员，要求登录 |
| 五个 crm-* 数据源 | 是 | 新 Base Token、表 ID、字段 ID |
| crm-daily-notice | 是 | deploy/templates/crm-daily-notice.json，动态收件人 |
| 附件授权码 | 是 | 目标账号取得 FEISHU_BASE_PERSONAL_TOKEN |
| 妙搭数据库 | 是 | 独立应用的 dev、online |
| CRM_PUBLIC_URL | 是 | 本轮发布成功返回的 online_url |
| crmDailyReminder | 是 | cron，每半小时检查通知设置 |

## 操作顺序

1. 在目标企业登录妙搭，创建全栈应用；不要复制原应用的环境变量。记录新 `app_...`。
2. 在目标企业创建空白多维表格。按 `blueprint.json` 的 schemas 建五张表，再按 links 创建关联，再加 formulas，最后创建 views/dashboard。字段名称、类型、枚举和关联方向必须一致。不要复制任何原业务记录或权限配置人员。
3. 设置 Base 高级权限。业务由妙搭服务访问，普通员工不需要直接编辑 Base；权限配置表只允许管理员。对应自动步骤见 `engine.mjs` 的 permissionsAndMembers。确认 Base/应用所有者具备实际读写权限。
4. 在妙搭创建 `crm_admin` 管理员角色并绑定目标管理员。企业范围开放时设为本企业且要求登录；指定人员范围则分配 `crm_employee` 并配置可见人员。不得将管理员角色授予全企业。
5. 用目标 profile 初始化应用独立代码目录。保留这次初始化生成的 `.spark`、`.spark_project`、`.env.local` 和 `.npmrc`；复制运行源码时不覆盖这些文件。交付包里的 `deploy/source.tar` 是运行源码，可以先解压到一个空目录再复制。
6. 修改 `shared/crm.ts` 中 BASE_URL 为新 Base 地址。根据新表字段生成 `server/capabilities/crm-customer.json`、crm-contact、crm-project、crm-followup、crm-access：所有 appToken、tableID、字段 ID 都必须来自新表。不要仅替换 appToken 后保留旧字段 ID。可复用 `core.mjs` 的 capability 函数，保持 access 仅“待配置角色”可写等字段限制。
7. 将 `deploy/templates/crm-daily-notice.json` 复制到 `server/capabilities/`。安装以下插件（在目标工程目录执行）：

```powershell
lark-cli apps +plugin-install --name @official-plugins/feishu-bitable --version 1.0.22 --as user --profile company-b
lark-cli apps +plugin-install --name @official-plugins/send-feishu-message --version 1.0.33 --as user --profile company-b
```

8. 初始化数据库。运行源码含 `server/database/notification.sql`、`followup-write.sql`、`deletion.sql`、`notification-seed.sql`。前三份原始 SQL 的策略创建不可直接反复执行。使用部署工具生成带事务、存在性和结构校验的 SQL：在源码仓库根目录（或包内已解压运行源码的根目录）执行下面的 Node 命令；`runtime.mjs` 路径按实际部署工具位置填写。

```powershell
node --input-type=module -e "import fs from 'node:fs'; import {databaseBootstrap} from './deploy/runtime.mjs'; fs.writeFileSync('crm-init.sql',databaseBootstrap('./server/database'));"
lark-cli apps +db-execute --app-id app_TARGET --environment dev --file crm-init.sql --yes --as user --profile company-b
lark-cli apps +db-execute --app-id app_TARGET --environment online --file crm-init.sql --yes --as user --profile company-b
```

只对新应用做首次初始化；不通过 reset/import 清空任何库。两环境分别初始化，daily 默认关闭、接收人为空，重跑不会覆盖已有配置。不把生产业务数据复制到开发库。缺少 dev 环境时停止，先核对平台应用环境配置。

9. 在目标妙搭应用 dev/online 的服务端环境变量填写目标账号的 `FEISHU_BASE_PERSONAL_TOKEN`。授权码从目标账号的多维表格自定义插件“获取授权码”取得；不是 OAuth 授权链接上的临时 code，也不是源账号 CLI Token。配置后检查新 Base 的上传权限。
10. 创建通知触发器，暂不启用：

```powershell
lark-cli apps +automation-create --app-id app_TARGET --name crmDailyReminder --trigger-type cron --cron "*/30 * * * *" --timezone Asia/Shanghai --status disabled --as user --profile company-b
```

11. 在目标工程执行 `npm ci`、`npm run precommit`、前端生产构建。提交代码并推送目标应用 Git 的 `sprint/default`。检查 origin 确实是新应用仓库，不能指向源应用。
12. 发起发布并用返回的 release ID 查询同一轮结果：

```powershell
lark-cli apps +release-create --app-id app_TARGET --branch sprint/default --apply-reason "独立企业首次部署" --as user --profile company-b
lark-cli apps +release-get --app-id app_TARGET --release-id RELEASE_ID --as user --profile company-b
```

必须等到 finished，核对 commit_id 与目标分支提交一致。保存返回的 online_url。然后在 dev/online 服务端变量设置 `CRM_PUBLIC_URL` 为该正式地址，重新发布并确认 finished。不得沿用源码中原应用地址；通知设置保持关闭直到此步骤完成。
13. 启用触发器并回读：

```powershell
lark-cli apps +automation-enable --app-id app_TARGET --name crmDailyReminder --as user --profile company-b
lark-cli apps +automation-get --app-id app_TARGET --name crmDailyReminder --as user --profile company-b
```

触发器应为 enabled；界面中的通知总开关仍为关闭。管理员选择收件人、时间后再开启每日通知。需要测试消息时由管理员点击“发送测试给我”。
14. 按 [自动部署说明的验收清单](README.md#4-结果与验收) 核对业务保存、附件、成员权限、通知链接。最后分发正式 online_url；需要飞书工作台入口时，再配置企业自建应用的网页地址和可用范围并发布。

## 完全不用 lark-cli 时

可以在目标企业的 Base、妙搭管理页逐项完成上述同等配置，用 Git 推送代码。数据库需在妙搭数据库管理界面执行初始化 SQL，插件、环境变量、角色、定时器和发布需分别操作。若当前套餐/界面没有某项入口，应由目标企业管理员确认功能可用性，不能跳过该依赖后宣布部署完成。

本地 Node 部署脚本不依赖源企业账号，但它使用 lark-cli 完成远端操作；“脚本部署”和“完全不用 CLI”是两种路径。首次目标授权和平台审批无法免除。
