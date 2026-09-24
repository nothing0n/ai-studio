# AI Bot

一个可以部署在 GitHub Pages 的个人 AI 聊天工作台：默认只有个人管家，其他 Bot 由你手动创建；管家可以将问题分配给你配置的团队成员。电脑和手机共用一个网页，聊天通过 GitHub API 同步到你自己的私有仓库。

- 网页：[nothing0n.github.io/ai-studio](https://nothing0n.github.io/ai-studio/)
- 网页源码：[nothing0n/ai-studio](https://github.com/nothing0n/ai-studio)
- 私有数据：[nothing0n/ai-studio-data](https://github.com/nothing0n/ai-studio-data)

## 开始使用

1. 打开网页，进入「设置与连接 → 模型连接」。填写名称、API Base URL、模型 ID 和 API Key。支持 OpenAI 兼容的 `chat/completions` 接口，以及允许浏览器访问的本机模型服务。
2. 回到工作台开始聊天。管家先根据明确的角色指令和关键词分配问题；当你已经创建其他 Bot、首次问题不明确时，可调用默认模型选择角色。短追问保持当前角色。点击左侧角色，可以手动切换并沿用当前会话。
3. 在「GitHub 同步」填写 `nothing0n/ai-studio-data` 和访问令牌。分支通常留空。首次连接会验证仓库为私有，再初始化数据目录。
4. 在另一台设备打开相同网页，配置同一个数据仓库和访问令牌即可同步历史。模型密钥也需要在每台设备分别填写。

GitHub 访问令牌在 [GitHub 官方设置](https://github.com/settings/personal-access-tokens/new) 创建。选择 **Only select repositories → ai-studio-data**，仓库权限只需 **Contents: Read and write**，并设置有效期。不要在源码、聊天或 issue 中填写真实令牌。

## 已包含的功能

- 可编辑角色名称、职责、指令、关键词、颜色和模型连接。
- 多个模型连接；角色可以使用指定连接，或跟随管家的默认连接。
- 同一聊天窗口内交接上下文，标明每条回复的角色。
- 流式文本、停止生成、失败提示、重试最近的问题、Markdown 与代码块。
- 本机保存、重命名/删除会话、导入/导出不含凭据的 JSON 备份。
- 每轮完成后同步、页面重新获得焦点时同步、手动同步。
- 以消息 ID 合并电脑/手机的新增消息；冲突时重新读取 GitHub 文件版本并重试。
- 删除标记避免旧设备复活已删除会话；并发删除与新增产生恢复副本。
- 并发修改角色配置时保留冲突副本。
- 手机抽屉导航、键盘操作、中文输入法兼容。

## 数据和密钥

GitHub Pages 只提供网页。所有应用逻辑运行在浏览器里，没有额外的应用服务器。

私有仓库的数据结构：

```text
studio-data/
  settings.json               # 角色、模型地址、模型 ID；不含密钥
  conversations/<uuid>.json    # 每个会话一个文件
```

GitHub PAT 和模型 API Key 保存在当前标签页的 `sessionStorage`，不写入持久聊天数据、仓库或导出备份。刷新页面可以继续使用；新的浏览器会话需要重新填写，浏览器的会话恢复行为可能有所不同。可以在「数据与备份」主动清除密钥。网页脚本可以读取会话密钥，因此只使用你信任的源码和部署。

模型请求只发往你配置的地址，GitHub 请求只发往 `api.github.com`。当已保存密钥对应的模型地址改变时，需要重新填写密钥。模型回复经过 HTML 清理，不加载回复里的图片或执行脚本。

## 当前边界

- 模型服务必须支持浏览器跨域调用（CORS）。如果服务禁止浏览器直接访问，需要另行部署受保护的转发服务；GitHub Pages 本身不能提供该功能。
- 托管及仓库同步可以使用免费额度，模型调用按供应商规则计费。首次管家智能分配可能多调用一次模型。
- 每次模型请求携带最近 40 条有效消息。长对话可以请角色先总结，再开启新会话；目前没有自动长期记忆或文件知识库。
- 聊天在浏览器中即时保存，在一轮回答完成后上传，不逐字产生 Git 提交。单个远端会话文件限制为 950 KB，超限时保留本机数据并提示导出、开启新会话。
- GitHub 有请求频率限制；失败时保留本机数据，修复连接或额度后重试。
- 删除会话不等于清除仓库 Git 历史。请勿将 API 密钥混入聊天正文。
- 本机聊天使用浏览器存储，有空间上限。清理网站数据前先同步或导出。多人协作、高频数据写入不属于这个版本的目标。
- 主动停止后保留已收到的内容，重试不会自动发起，也不会重复插入用户问题。

## 本地开发

需要 Node.js 24 和 npm：

```sh
npm ci
npm run dev
```

```sh
npm test          # 模拟流式协议、同步冲突、数据校验；不调用真实模型
npm run build    # 输出 dist/
npm run test:ui  # 桌面和手机浏览器测试；默认使用本机 Microsoft Edge
```

浏览器测试使用模拟模型和模拟 GitHub，不需要真实密钥。其他环境可在 `playwright.config.js` 调整浏览器 channel。

## 发布

仓库的 Pages 构建方式设为 **GitHub Actions**。推送到 `main` 后，`.github/workflows/deploy.yml` 自动安装依赖、运行逻辑测试、构建并发布 `dist`。

所有资源使用相对路径，因此支持 `https://用户名.github.io/仓库名/`。无需将任何 GitHub PAT 或模型密钥配置到 Actions Secrets；网页运行时由本人填写。
