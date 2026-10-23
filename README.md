# 客户与项目协作管理

妙搭全栈应用 `app_example000001`，代码分支 `sprint/default`。React 页面 → NestJS 业务 API → 官方飞书多维表格插件；客户与项目数据仍存于原 Base。

## 当前版本

管理员验证版：真实列表、搜索、分页、详情、客户/联系人/项目/跟进新建、核查、当前计划更新、结束建议、授权意向维护。实际权限来自平台 `crm_admin` 角色。普通员工行级授权及完整生命周期操作尚未验收；项目结束确认、归档、重开仍在原生 Base 处理。

已补齐四类业务记录的日常编辑：列表行“编辑”及详情“编辑资料”均可进入，打开时重新读取原值，保存仅提交改动字段。填写修改说明后保存，记录重新进入待核查；核查与编辑均追加说明，保留之前历史。当前计划与结束建议表单也会回填原值。

企业/项目归属迁移、已归档/已结束/停用/作废记录仍需专门流程。当前插件不支持清空日期、数值、单选字段，尝试此操作会在写入前明确拒绝；文本和人员/联系人关联可以清空，必填约束仍有效。

Base 权限表维护的是授权意向，修改它不会自动授予 Base 或妙搭权限。插件使用应用所有者的 Base 权限，因此所有业务接口均校验实际平台角色，直接 capability HTTP 入口被禁用。

## 本地运行

Node.js >=22（本次验证24.19），lark-cli1.0.98。所有远程调用固定 `--profile feishu-validation --as user`。

```powershell
npm ci
lark-cli apps +plugin-install --name @official-plugins/feishu-bitable --as user --profile feishu-validation
lark-cli apps +env-pull --app-id app_example000001 --as user --profile feishu-validation
node scripts/dev-windows.cjs server
# 另一个终端
node scripts/dev-windows.cjs client
```

访问 `http://127.0.0.1:4177/app/app_example000001/`。`.env.local` 只供本机使用，禁止提交、打印。env-pull 当前返回空角色时本地业务页拒绝访问；不能手工伪造角色绕过。

## 校验与发布

```powershell
npm run lint
node node_modules/@nestjs/cli/bin/nest.js build
node --test scripts/tests/crm.test.cjs
$env:NODE_ENV='production'
node node_modules/vite/bin/vite.js build --config vite.config.ts
```

离线测试验证输入、越权、核查边界，不代表真实账号端到端验收。真实 SDK 联调证据在父目录 `verification/miaoda-preflight/`，不会推送含业务内容的快照。

官方完整 `npm run build` 依赖平台提供的 `@lark-apaas/fullstack-cli`，该 CLI 当前在 Windows 有 ESM 路径兼容问题。云端 Linux 发布使用原始构建脚本；不要运行同名无 scope 的公共 npm 包 `fullstack-cli` 代替。

```powershell
git add .
git commit -m "Describe the reviewed change"
git push origin sprint/default
lark-cli apps +release-create --app-id app_example000001 --branch sprint/default --apply-reason "填写本次实际发布理由" --as user --profile feishu-validation
# 使用上一步真实返回的 release_id 查询，不能重复创建代替查询
lark-cli apps +release-get --app-id app_example000001 --release-id <实际ID> --as user --profile feishu-validation
```

只有 `finished` 表示本轮上线完成；`PENDING` 节点需审批负责人处理。完整操作、Windows 注意事项与发布结果见父目录 `妙搭发布指南.md`。
