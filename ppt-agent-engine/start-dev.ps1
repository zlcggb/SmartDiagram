# 一键准备并启动本地开发（Windows PowerShell）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "请先安装 Node.js 20+：https://nodejs.org/"
  exit 1
}

$pnpm = @("corepack", "pnpm")
try {
  corepack enable | Out-Null
} catch {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 corepack/pnpm，请升级 Node.js 或安装 pnpm"
    exit 1
  }
  $pnpm = @("pnpm")
}

Write-Host "==> 安装依赖"
& $pnpm[0] $pnpm[1..($pnpm.Length-1)] install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path ".env")) {
  Write-Host "==> 创建 .env（来自 .env.example）"
  $dbPath = (Join-Path $PSScriptRoot "prisma\dev.db") -replace "\\", "/"
  $dbUrl = "file:$dbPath"
  if (Test-Path ".env.example") {
    (Get-Content ".env.example") `
      -replace '^DATABASE_URL=.*', "DATABASE_URL=`"$dbUrl`"" `
      | Set-Content ".env" -Encoding UTF8
  } else {
    @"
DATABASE_URL="$dbUrl"
API_PORT=4000
WEB_PORT=5173
AI_PROVIDER="mock"
"@ | Set-Content ".env" -Encoding UTF8
  }
  Write-Host "    已写入 .env。若要用真实 Gemini，请编辑 .env 设置 AI_PROVIDER / GEMINI_API_KEY"
} else {
  Write-Host "==> 已存在 .env，跳过创建"
}

Write-Host "==> 生成 Prisma Client / 迁移数据库"
& $pnpm[0] $pnpm[1..($pnpm.Length-1)] db:generate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pnpm[0] $pnpm[1..($pnpm.Length-1)] db:migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> 启动开发服务"
Write-Host "    Web: http://127.0.0.1:5173"
Write-Host "    API: http://127.0.0.1:4000"
& $pnpm[0] $pnpm[1..($pnpm.Length-1)] dev
