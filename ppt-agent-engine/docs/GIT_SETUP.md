# Git 接入说明

当前目录里曾出现过空的 `.git` 文件夹，但它不是有效 Git 仓库。判断依据：

```powershell
git -C "D:\codex work\PPT-agent" rev-parse --show-toplevel
```

如果返回 `fatal: not a git repository`，说明还没有真正连接 Git。

## 第一次连接远端

在项目根目录执行：

```powershell
cd "D:\codex work\PPT-agent"
git init
git remote add origin <你的 Git 仓库地址>
git branch -M main
```

建议第一次提交：

```powershell
git add README.md ppt-agent-engine/.gitignore ppt-agent-engine/.env.example ppt-agent-engine/README.md ppt-agent-engine/docs ppt-agent-engine/apps ppt-agent-engine/packages ppt-agent-engine/prisma ppt-agent-engine/package.json ppt-agent-engine/pnpm-lock.yaml ppt-agent-engine/pnpm-workspace.yaml ppt-agent-engine/tsconfig.base.json
git commit -m "chore: initialize PPT-agent"
git push -u origin main
```

## 后续更新

```powershell
cd "D:\codex work\PPT-agent"
git status
git add README.md ppt-agent-engine
git commit -m "chore: update PPT-agent"
git push
```

## 不要提交

这些已经写入 `.gitignore`：

- `ppt-agent-engine/.env`
- `ppt-agent-engine/prisma/dev.db`
- `ppt-agent-engine/storage/exports/**`
- `ppt-agent-engine/node_modules`

如果你不确定某个文件能不能提交，先运行：

```powershell
git status --short
```

不要把 API Key、数据库、导出的 PPTX 提交到远端。
