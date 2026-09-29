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

## 日常运维习惯（P5-5 / D1-D3）

**哪些数据不可重建**——Telegram 是事实源，库里绝大多数东西都能重建；
**只有这三样例外**，丢了就没了：

1. **用户标签**（手动打的）
2. **注解**（写在详情页的备注）
3. **设置**（转发目标、来源黑名单等）

→ 定期备份：

```bash
pnpm -F @tma/core export:user-data     # 导出到 apps/core/.data/exports/
```

**其余都是派生数据**，坏了/脏了可以随时重建，不用怕：

| 动作 | 入口 | 什么时候用 |
|---|---|---|
| 重建搜索索引（+ 标签治理、标题清理、分类回填） | 设置页「重建搜索索引」 | 怀疑索引漂移 / 规则升级后 |
| 按最新规则重解析全部 | 设置页「按最新规则重解析全部」 | 文件名解析规则升级后（不碰 AI 产物、不花 token） |
| 压缩标签（AI 只看标签） | 设置页「压缩标签（AI 只看标签）」 | 标签明显变脏时；每轮都花 token |
| 重建向量索引 | 设置页「重建向量索引」 | 换 embedding 模型后 |
| 清空缩略图缓存 | 设置页「清空缩略图缓存」 | 磁盘紧张时（会按需重新下载） |

**日志**：`apps/core/.data/logs/core-YYYY-MM-DD.log`（JSON 行，按天轮转，保留 14 天）。
排障时 `grep` 这个文件比翻终端快。

**Bot 私聊（X1）**：私聊 Bot 发 `/start` 绑定归档通知——之后往归档群转发媒体，
入库和 AI 整理完成都会私聊推送（含归类与 AI 状态）；`/search` `/stats` `/recent` `/detail` `/pending`
可随时查询。`/stop` 关闭通知。

**改完代码的自检顺序**：

```bash
pnpm typecheck && pnpm lint && pnpm -r test && pnpm -F @tma/core smoke
```
