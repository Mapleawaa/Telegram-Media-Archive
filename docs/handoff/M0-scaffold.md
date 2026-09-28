# M0 — 脚手架

日期：2026-09-28 · 状态：✅ 达成

## 1. 目标与结论

搭建 pnpm workspace 骨架（`apps/core` + `apps/desktop` + `packages/shared`）、core 空壳（config/logger/health）、desktop 空壳（Vite+React19+Tailwind4+shadcn+React Router 预留+Tauri 2）、docs 纪律、cargo 镜像与预热。

结论：全部达成。桌面端在浏览器与 Tauri 窗口双通道验证通过，core health 接口连通，Rust 侧构建已预热（二次启动 <1s）。

## 2. 可复现命令与原始输出

```bash
# 环境（Git Bash）
eval "$(fnm env --shell bash)"   # node v24.21.0 / pnpm 12.6.0

# 类型检查
$ pnpm -r typecheck
packages/shared typecheck: Done
apps/core typecheck: Done
apps/desktop typecheck: Done

# core 启动
$ pnpm dev:core
[23:00:13] INFO: core 已启动：http://127.0.0.1:8787
$ curl -s http://127.0.0.1:8787/api/health
{"ok":true,"name":"telegram-media-archive","version":"0.1.0","uptimeSec":1,"startedAt":"2026-09-28T14:59:17.691Z"}

# 桌面端（浏览器验证 200，截图确认页面渲染 + “已连接 v0.1.0”）
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
200

# Tauri 窗口（cargo 预热后）
$ pnpm dev:desktop
     Running BeforeDevCommand (`pnpm run dev:web`)
     Running DevCommand (`cargo run --no-default-features --color always --`)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.41s
     Running `target\debug\tma-desktop.exe`
$ tasklist | grep tma-desktop
tma-desktop.exe   48268   Console   32,500 K

# cargo 预热（rsproxy 镜像，exit 0）
$ cargo build   # in apps/desktop/src-tauri
```

## 3. 验收清单

- [x] `pnpm -r typecheck` 通过（三包全绿）
- [x] `curl localhost:8787/api/health` 返回 200 JSON
- [x] Vite 5173 渲染 shadcn Button + Core 连通状态卡片（浏览器截图确认）
- [x] Tauri 窗口打开（`tma-desktop.exe` 进程存在，窗口 1440×900 居中）
- [x] git 首提交

## 4. 已知问题与偏离

| 项 | 说明 |
|---|---|
| pnpm 12 构建白名单 | `onlyBuiltDependencies` 已失效，改用 `pnpm-workspace.yaml` 的 `allowBuilds` 映射（esbuild / better-sqlite3 已放行） |
| Vite watch 必须排除 src-tauri | cargo 写 `target/` 时 Vite 文件监听 EBUSY 崩溃 → `server.watch.ignored: ['**/src-tauri/**']`（Tauri 官方建议，必须保留） |
| 停止 dev 进程要用 taskkill | TaskStop 杀 pnpm 包装进程后，vite 的 node 进程仍占 5173 → 用 `netstat -ano | grep :5173` + `taskkill //PID <pid> //F` |
| shadcn 4.x 新形态 | 用 `radix-nova` 预设（Radix 底座 + Lucide + Geist 字体），`cn` 为独立 npm 包；`index.css` 引入 `shadcn/tailwind.css` 与 `@fontsource-variable/geist` |
| Tauri 标识 | identifier = `com.maple.tma-desktop`；Rust 包名 `tma-desktop`，lib `tma_desktop_lib` |
| CSP 已预设 | `connect-src` 白名单 `http://127.0.0.1:8787 ws://127.0.0.1:8787`（dev 阶段 Tauri 不强制 CSP，M1 生产构建时验证） |
| 偏离计划处 | 计划里 core 未起桌面端应显示「Core 未连接」——本版已实现该分支（fetch 失败态） |

## 5. 下一里程碑入口（M1）

工作流 A 步骤 1 已在 M0 完成（`src/config.ts` 含 zod 校验 + fail-fast + redact）；M1 从 **步骤 2：Drizzle 全 schema（`apps/core/src/database/schema.ts`）** 开工，随后 0000_init 迁移 + FTS5 自定义迁移。

令牌与群 ID 存于 `apps/core/.env`（已 gitignore），代码与文档中均未出现。
