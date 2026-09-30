# Telegram Media Archive

[![CI](https://github.com/Mapleawaa/Telegram-Media-Archive/actions/workflows/ci.yml/badge.svg)](https://github.com/Mapleawaa/Telegram-Media-Archive/actions/workflows/ci.yml)

AI 媒体归档整理器：**Telegram 保存原始媒体（source of truth），本地 Archive Core 保存派生数据**（元数据 / 分类 / 标签 / 索引 / AI 富化 / 操作轨迹），Tauri 桌面端做影音墙式可视化工作台（对标 Jellyfin / Emby / Apple TV 的浏览逻辑，但不做播放——播放仍回 Telegram）。

架构稿见 [docs/architecture.md](docs/architecture.md)，推进路线见 [docs/roadmap.md](docs/roadmap.md)。

## 功能特性

- **归档门控（X2，默认）**：转发媒体进群 → Bot 引用消息问「需要让 AI 审核这个帖子吗？」——
  「是」走 AI 富化；「否」标为其他并弹分类键盘手动归（成人/游戏/图书/电影/剧集/动漫/图集/其他）。
  相册整组一问一答。设置页可切回全自动模式。
- **Bot 私聊（X1）**：归档入库、去重合并、AI 整理完成（含最终分类+标签）、来源拉黑、AI 失败——
  五类事件主动私聊推送；`/search` `/stats` `/recent` `/detail` `/pending` 随时查询。
- **AI 富化**：文本（标题/摘要/标签/分类）+ 视觉（缩略图描述）双模型，来源黑名单分流，
  `ai_runs/ai_steps` 全程记账可审计；标签压缩作业「只看标签不看内容」。
- **分类体系（八类）**：电影/剧集/动漫/成人/图集/游戏/图书/其他，赋值优先级 `user > llm > rule`；
  成人内容自动置敏感标记，配合桌面端隐私模式（默认隐藏、临时放行）。
- **混合检索**：FTS + 向量三路召回、RRF 融合；未配置 embedding 自动降级。
- **桌面影音墙**：深色优先 + 霞鹜文楷、海报墙三种封面排列（竖屏/方形/原始比例瀑布流）、
  分类夹货架、悬停/右键/快捷键、软删除、手动改标题锁定、多来源设主源、相册整组转发。

## 环境要求

- Node >= 22 + pnpm 12+
- Rust（MSVC 工具链）+ WebView2（Tauri 2，仅桌面端需要）

## 快速开始

```bash
pnpm install
cp apps/core/.env.example apps/core/.env   # 填 TG_BOT_TOKEN / TG_ARCHIVE_CHAT_ID，AI 三选一（openai 兼容 / ollama / mock）
pnpm dev:core        # 启动 core（http://127.0.0.1:8787）
pnpm dev:desktop     # 启动 Tauri 桌面端（自动拉起 Vite 5173）
```

常用命令：

```bash
pnpm typecheck                     # 全仓类型检查
pnpm lint                          # oxlint（0 警告门禁）
pnpm test                          # 单元测试（161 个）
pnpm -F @tma/core smoke            # 端到端冒烟（65 项断言，mock AI 自包含）
pnpm -F @tma/desktop tauri build   # 打包桌面端（exe + MSI）
```

## 打包桌面端

```bash
pnpm -F @tma/desktop tauri build
# 产物：src-tauri/target/release/tma-desktop.exe（裸 exe）
#       src-tauri/target/release/bundle/msi/*.msi（MSI 安装包）
```

注意两点：vite 清空 `dist/` 时如遇删除守卫报错，先手动移走旧 `dist/`；
首次打包 Tauri 需从 GitHub 下载 WiX/NSIS，网络受限时给 shell 设 `HTTPS_PROXY`。
推 `v*` 标签会触发 GitHub Actions 自动打包并建 Release 草稿（见 `.github/workflows/release.yml`）。

## 日常运维

**哪些数据不可重建**——Telegram 是事实源，库里绝大多数东西都能重建；
**只有三样例外**：用户标签、注解、设置。定期备份：

```bash
pnpm -F @tma/core export:user-data     # 导出到 apps/core/.data/exports/
```

| 动作 | 入口 | 什么时候用 |
|---|---|---|
| 重建搜索索引（+ 标签治理、标题清理、分类回填） | 设置页「重建搜索索引」 | 怀疑索引漂移 / 规则升级后 |
| 按最新规则重解析全部 | 设置页「按最新规则重解析全部」 | 文件名解析规则升级后（不碰 AI 产物、不花 token） |
| 压缩标签（AI 只看标签） | 设置页「压缩标签（AI 只看标签）」 | 标签明显变脏时；每轮都花 token |
| 重建向量索引 | 设置页「重建向量索引」 | 换 embedding 模型后 |
| 清空缩略图缓存 | 设置页「清空缩略图缓存」 | 磁盘紧张时（会按需重新下载） |

**日志**：`apps/core/.data/logs/core-YYYY-MM-DD.log`（JSON 行，按天轮转，保留 14 天，自动脱敏）。

## 安全与纪律

- `.env`、session 文件、`.data*/`、日志**永不提交**（`.gitignore` 已覆盖）；
- 日志输出自动脱敏 token/key；
- AI 内容审核类产物均为派生数据，可随时清退重建（`purge:ai`）。

## License

本项目以 [GPL-3.0-or-later](LICENSE) 发布。
