# 聚典核校用户反馈大屏（Supabase 云端版）

打开页面先输入口令。口令写在 `config.js` 的 `pagePass`，当前是 `聚典大屏`。改口令后重新打开页面即可。

口令通过后会尝试从 Supabase 拉取数据；云端不可用时用本机 IndexedDB 缓存继续查看。保存时若云端仍不可用，改动先留在本机。

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
3. 首次打开会先出现口令页；口令正确后进入管理与大屏。

## 安全说明

- 口令只挡页面。`config.js` 会随网站公开，能查看源码的人可以看到 `pagePass` 和 anon key。
- 这不是账号登录。云端数据是否能读写，仍取决于 Supabase 项目是否在运行，以及表的访问策略。

## 数据备份

「展示设置」里仍可导出/导入 JSON。覆盖导入会先清空云端再写入；合并导入会把文件里的行 upsert 到云端。
