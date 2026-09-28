# Telegram Media Archive

AI 媒体归档整理器：Telegram 保存原始媒体（source of truth），本地 Archive Core 保存派生数据（元数据 / 索引 / AI / 操作轨迹），Tauri 桌面端做可视化工作台。

架构稿见 [docs/architecture.md](docs/architecture.md)，推进路线见 [docs/roadmap.md](docs/roadmap.md)。

## 环境要求

- Node >= 22（经 fnm 管理，当前钉 24.21.0）
- pnpm 12+
- Rust（MSVC 工具链）+ WebView2（Tauri 2）

> Git Bash 里先执行 `eval "$(fnm env --shell bash)"`，否则 node / pnpm 不可见。

## 常用命令

```bash
pnpm install       # 安装依赖
pnpm dev:core      # 启动 core（http://127.0.0.1:8787）
pnpm dev:desktop   # 启动 Tauri 桌面端（自动拉起 Vite 5173）
pnpm typecheck     # 全仓类型检查
pnpm test          # 运行测试
```

core 与 desktop 建议各开一个终端（`pnpm dev` 用 concurrently 一键启动，但 Tauri dev 热键会失效）。

## 网络备忘

- npm 直连 npmjs 即可；慢时可临时用 `npm_config_registry=https://registry.npmmirror.com pnpm install`
- cargo 已配 rsproxy 镜像（`~/.cargo/config.toml`），首次构建无需代理

## 纪律

- `.env`、session 文件、`.data/` 永不提交；push 前先问
- 每个里程碑收口写 `docs/handoff/M{n}-*.md`（目标结论 / 命令原始输出 / 验收勾选 / 已知问题）
- 架构稿偏离只追加「实施附录」，不回改正文
