# 聚典核校 · 用户反馈大屏

纯静态页面（HTML + CSS + JS），数据保存在访问者本机浏览器的 **IndexedDB**，无需后端即可使用。

## 在线访问（GitHub Pages）

部署成功后访问地址一般为：

`https://<你的GitHub用户名>.github.io/<仓库名>/`

本仓库 **HPP** 的地址为：

**https://pangpang2333.github.io/HPP/**

> 换浏览器或清除站点数据后，反馈记录不会同步；公开仓库请勿上传含隐私的截图。

## 一键部署步骤

### 1. 在 GitHub 新建仓库

1. 打开 [https://github.com/new](https://github.com/new)
2. 仓库名建议：`feedback-dashboard`（可自定）
3. 选择 **Public**（公开仓库才能免费用 GitHub Pages）
4. **不要**勾选 “Add a README”（避免与本地首次推送冲突）
5. 创建仓库

### 2. 把本项目推送到 GitHub

在电脑上安装 [Git for Windows](https://git-scm.com/download/win) 后，在本项目文件夹打开终端，执行（把 `你的用户名` 和 `仓库名` 换成自己的）：

```powershell
cd "本项目文件夹路径"
git init
git add index.html app.js styles.css logo.svg .nojekyll .gitignore README.md .github
git commit -m "Initial commit: feedback dashboard for GitHub Pages"
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

首次 `git push` 会要求登录 GitHub（浏览器或 Personal Access Token）。

### 3. 开启 GitHub Pages（首次必做）

1. 打开仓库 → **Settings** → **Pages**
2. **Build and deployment** → **Source** 选 **Deploy from a branch**
3. **Branch** 选 **gh-pages**，文件夹选 **/ (root)**，点 **Save**
4. 推送 `main` 后 Actions 会把静态文件发布到 `gh-pages` 分支；约 1～2 分钟后可访问站点 URL

也可在 **Actions** 标签页查看 **Deploy GitHub Pages** 是否成功（绿色勾）。

### 4. 之后更新网站

修改 `index.html` / `app.js` / `styles.css` 后：

```powershell
git add index.html app.js styles.css logo.svg
git commit -m "Update dashboard"
git push
```

推送后 Actions 会重新发布，稍等刷新即可。

## 本地预览

直接用浏览器打开 `index.html`，或用任意静态服务器，例如：

```powershell
python -m http.server 8080
```

然后访问 `http://localhost:8080/`

## 说明

- **审校 PDF 分析**（`review/` + `server/`）依赖本机 Python 服务，**不会**在 GitHub Pages 上运行；在线版仅包含反馈大屏与管理功能。
- 仓库中的 `scripts/`、`docs/` 等不会被打进 Pages 站点（工作流只发布 4 个静态文件）。
