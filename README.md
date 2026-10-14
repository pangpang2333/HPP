# 聚典核校用户反馈大屏（Supabase 云端版）

打开页面会从 Supabase 拉取最新数据；在管理页保存/删除后会自动同步到云端。本地 IndexedDB 仍作缓存，断网后可继续查看已缓存内容。

## 本地预览

用任意静态服务器打开本目录，例如：

```bash
npx serve .
# 或 python3 -m http.server 8080
```

然后访问提示的地址。不要直接用 `file://` 打开（浏览器会限制部分能力）。

## 部署到 GitHub Pages

把本目录里的文件推到你的 Pages 仓库（例如原来的 `pangpang2333.github.io/HPP/`）：

1. 用本目录内容覆盖仓库里对应静态文件（至少包含 `index.html`、`app.js`、`styles.css`、`logo.svg`、`config.js`）。
2. 提交并推送后，打开：https://pangpang2333.github.io/HPP/
3. 首次打开会自动从云端加载已导入的反馈；之后在任意电脑上录入都会同步。

## 安全说明

`config.js` 里的 anon key + 当前开放的 RLS 表示：**拿到页面链接的人可以读、写、删云端数据**。适合内部小范围使用。若要对外公开只读，请在 Supabase 收紧 RLS 或加登录。

## 数据备份

「展示设置」里仍可导出/导入 JSON。覆盖导入会先清空云端再写入；合并导入会把文件里的行 upsert 到云端。
