# 聚典核校 · 用户反馈大屏（静态口令版）

纯静态页面，部署在 GitHub Pages。

## 访问

https://pangpang2333.github.io/HPP/

- 打开后输入口令（见 `config.js` 的 `pagePass`）
- 进入后自动加载 `shared-data.json`（共享数据包），所有人看到同一份内容

## 更新共享内容

1. 在网页里改完数据后，到「展示设置」→「导出全部数据（JSON）」
2. 用导出文件覆盖仓库根目录的 `shared-data.json`
3. `git add shared-data.json && git commit && git push`

## 修改口令

编辑 `config.js` 中的 `pagePass`，推送后重新打开页面即可。

## 说明

- 不再依赖 Supabase / 任何后端
- 本机编辑只保存在当前浏览器；要让别人看到新内容，必须更新并推送 `shared-data.json`
- 口令写在前端配置里，适合防误闯，不是银行级加密
