# 跟进附件上传

## 配置

在妙搭应用的服务端环境变量中设置 `FEISHU_BASE_PERSONAL_TOKEN`，值为当前多维表格已启用的个人授权码。正式版使用 `online` 环境；开发环境应单独配置对应表格的授权码。不要将授权码放入前端、Git 或业务数据表。

Base 和跟进表 ID 复用 `crm-followup` 插件实例中的 `appToken`、`tableID`。授权码必须能访问该表格。无需额外配置 `FEISHU_APP_ID` 或 `FEISHU_APP_SECRET`。

## 保存流程

前端上传至应用文件存储，服务端核对原文件名和大小后下载文件内容。服务端使用个人授权码调用 `https://base-api.feishu.cn/open-apis/drive/v1/medias/upload_all`，明确提交 `file_name`、`parent_type=bitable_file` 和当前 Base 的 `parent_node`。上传返回的 `file_token` 通过记录更新 API 写入附件字段。

业务字段继续使用原有多维表格插件；附件不再传给插件的 URL 导入接口。保留附件复用原生 token，移除附件写入剩余 token 列表，下载链接过期不会触发重新导入。

附件上传在业务记录保存前完成，缺少授权码或上传失败时不创建记录。业务记录保存和附件关联是两次独立写入：如果后一步失败，返回已保存记录的 ID，提醒刷新核对，不自动重复创建。回读同时校验原文件名、大小、数量和原生 token。

已有错误文件名不会自动恢复；应核对原文件后重新上传。不要从编码后的旧名字推测原文件内容。

## 验证

`npm test` 包含上传文件内容与原名、授权域名、缺失配置、保留/移除附件、回读异常及新建保存流程的离线回归。离线测试不能替代线上授权码与实际文件的联调验收。

参考：[官方 Base SDK](https://github.com/larksuite/base-sdk-go)、[官方授权码入口说明](https://github.com/Lark-Base-Team/lark-base-mcp-node-server#tokens)。
