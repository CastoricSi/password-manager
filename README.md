<p align="center"><img src="public/icon-192.png" width="96" alt="" /></p>

<h1 align="center">密码管理器</h1>
<p align="center">盗贼之神也无可奈何的神器</p>

简单、护眼、只属于你自己的密码本。所有内容在浏览器里处理；设了总密码的本子会加密后才保存或上传。

在线使用：<https://pw.si16.app>（也可用 <https://password.si16.app>）· [隐私政策](https://pw.si16.app/privacy) · [服务条款](https://pw.si16.app/terms)

- **两种用法**：第一次打开时选择「使用本地数据」或「使用谷歌账户」。
- **多个密码本**：每本可以「设总密码」（加密）或「不设密码」（打开即用）。「锁定」只锁有密码的本子。
- **分步新建**：名称和保护方式 → 总密码和密码提示 → 找回问题和答案提示（可跳过）；也可以直接导入备份。
- **常见的三栏布局**：侧边栏（密码本、分类及数量、同步状态、设置、锁定）· 列表 · 详情。详情页直接编辑，Ctrl+S 保存。
  大屏可在「设置 → 通用」切换为表格视图；手机上列表和详情分页显示。
- **分类**：在侧边栏直接新建、重命名、删除。**自定义字段**：每本单独开关（默认关闭）。**附件**：每个 ≤ 5 MB，和本子一起加密。
- **网址记住位置**：当前的密码本、条目、分类和设置页都在网址里，浏览器的后退 / 前进 / 刷新都按预期工作（网址里只有 ID，没有名称或内容）。
- **谷歌同步**：登录一次后所有密码本自动同步到你谷歌云盘的「密码管理器」文件夹；按条目合并；删除 30 天内可恢复。
- **分享**：把一本分享给别人的谷歌邮箱。对方登录后点「添加」并在谷歌窗口确认一次，之后双方的修改自动同步。总密码不会分享。
- 自动锁定、导出 / 导入备份、护眼浅色与深色主题、中文 / English。

## 开发

```bash
npm install      # 请使用仓库中的 package-lock.json
npm run dev      # http://localhost:5173
npm run test     # 单元测试（加密、合并、同步与分享、Google 登录、分享通知）
npm run build
npm run deploy   # Cloudflare Workers（域名见 wrangler.json：pw.si16.app、password.si16.app）
```

界面来自自己的设计系统 [sityle](https://github.com/CastoricSi/sityle)（丹青），从 GitHub Release 的 `.tgz` 安装；
升级后需重启 `npm run dev`。隐私政策和服务条款是 `public/privacy.html`、`public/terms.html` 两个静态页面。

## 开启谷歌同步与分享

只用到普通权限 `drive.file`（应用只能访问自己创建、或用户在谷歌文件选择器里亲自选中的文件），
不需要谷歌的受限权限审核，可以正式发布、长期保持登录。登录由 Cloudflare Worker 代为完成；
长期凭证只保存在加密的 HttpOnly Cookie 里，网页脚本拿不到。

1. [Google Cloud Console](https://console.cloud.google.com/) → 新建（或选择）项目。
2. 「API 和服务 → 库」：启用 **Google Drive API** 和 **Google Picker API**。
3. 「OAuth 同意屏幕」：用户类型选「外部」，范围添加 `.../auth/drive.file`、`openid`、`email`，然后**发布为正式版**
   （`drive.file` 不需要审核；停留在「测试」状态时，谷歌会让登录每 7 天失效一次）。
   「品牌塑造 → 应用网域」：首页 `https://pw.si16.app`，隐私政策 `https://pw.si16.app/privacy`，
   服务条款 `https://pw.si16.app/terms`；「已获授权的网域」添加 `si16.app`。
4. 「凭据 → 创建凭据 → OAuth 客户端 ID」：类型选 **Web 应用**，「已获授权的重定向 URI」填（每个域名一条）：
   - `https://pw.si16.app/api/auth/google/callback`
   - `https://password.si16.app/api/auth/google/callback`
   - 本地开发：`http://localhost:5173/api/auth/google/callback`
5. 「凭据 → 创建凭据 → API 密钥」（给谷歌文件选择器用）：限制为「HTTP 引荐来源」= `https://pw.si16.app/*` 和 `https://password.si16.app/*`，API 限制为 Picker API。
   另外记下项目的**项目编号**（Cloud 控制台首页，「项目编号」，纯数字）。
6. 把下载的文件放进项目根目录的 `secret/` 文件夹（已在 `.gitignore` 中，不会被提交）：
   - `secret/client_secret.json` —— 第 4 步下载的 OAuth 客户端 JSON
   - `secret/api_key.txt` —— 第 5 步的 API 密钥
   - `secret/project_number.txt` —— 项目编号

   然后运行：
   ```bash
   npm run secrets:dev    # 生成 .dev.vars（npm run dev 时也会自动执行）
   npm run secrets:prod   # 上传到 Cloudflare（需先 npx wrangler login）
   ```
   第一次运行会自动生成 `secret/session_secret.txt`（加密登录 Cookie 用），之后保持不变；
   改动它会让所有人需要重新登录谷歌。
7. 分享提示用到一个 KV（`wrangler.json` 里的 `SHARES`）。新版 wrangler 部署时会自动创建；
   如果部署提示缺少 id，运行 `npx wrangler kv namespace create SHARES`，把输出的 id 填进 `wrangler.json`。
   KV 里只保存"谁把哪个文件分享给了谁"，不保存任何密码本内容。

没有配置时，应用照常可用：起始页的「使用谷歌账户」会显示为不可用。
没配第 5 步时同步正常，但别人分享的本子暂时无法添加。

### 分享是怎么工作的

A 分享给 B：应用通过 Google Drive 给 B 这个文件的编辑权限（谷歌也会发邮件），并在 KV 里留一条提示。
B 登录后看到「A 和你分享了『家庭』」，点「添加」，在谷歌文件选择器里确认一次（谷歌对 `drive.file` 的要求），
之后 A 和 B 的设备都同步这同一个文件，按条目合并。A 移除 B、或删除这本，B 那里会随之消失；B 也可以「退出共享」。

技术栈：React 19 · Vite · sityle（Motion）· WebCrypto（AES-GCM + PBKDF2-SHA256 60 万次）· IndexedDB · Hono on Cloudflare Workers（+ KV）。
设计与结构说明见 [CLAUDE.md](CLAUDE.md)。
