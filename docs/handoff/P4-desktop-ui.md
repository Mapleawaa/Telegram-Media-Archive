# P4 — Desktop UI 重设计（影音墙）

日期：2026-09-29 · 状态：**第 1 轮完成（P4-1 视觉基调 + P4-2 首页），待用户实机审阅后迭代**
依据：`docs/handoff/NEXT-P2-P5-handoff.md` §7、`docs/fix-plan.md` P4、`docs/known-issues.md` U2 / U3 / B10 / B11
前置：P3 已完成（`4ed386c`）

> 用户诉求（U2）原话：「UI 太像后端了，太像 shadcn 的设计语言，不适合一个中台应用。
> 建议把整个 UI 和交互逻辑设计成真正适合桌面客户端体验的 UI」；对标 Jellyfin / Emby / Apple TV；**深色优先**。
> 方式（已确认）：**先做出一版具体实现 → 用户实机看完 → 按反馈多轮微调**（不先做方案讨论）。

---

## 1. 目标与结论（第 1 轮）

**本轮只做「视觉基调 + 首页」**（任务书建议：先做 P4-1 + P4-2 的一版可看效果，避免一次性重写返工）。

做了：

| 项 | 内容 |
|---|---|
| 主题体系 | 接入 `next-themes`（本来就已安装但没接线），`<html class="dark">`；**默认深色**，可切 浅色/深色/跟随系统；侧栏底部一键切换。Toast（sonner）现在跟着主题走 |
| 深色配色 | 重写 `index.css` 的语义色板：深底（`oklch(0.145)`）+ 更暗的侧栏形成层次 + 青蓝品牌色 `oklch(0.755 0.13 197)`；边框压到 9% 白，避免「后台管理」的灰盒子感 |
| 正文字体 | 霞鹜文楷（**默认**，用户偏好）与 Geist 一键切换；字体挂在 `<html data-font>`，只影响 `--font-ui`。字体包 `lxgw-wenkai-screen-webfont` **本地打包**（不依赖 CDN，离线可用） |
| 海报卡 | 新组件 `PosterCard`：2:3 竖版、图片铺满、底部渐变压字、悬停提亮 + 描边 + 图片微缩放；角标（敏感锁 / 相册数 / AI 状态点 / 分类） |
| 首页 | 新 `HomePage`（替换原 DashboardPage）：**Hero 大图**（最新一条 + 分类/大小/时长/来源数 + 摘要 + 动作）→ 失败任务薄条（仅在有失败时）→ **「最近归档」横向货架** → **各分类夹横向货架**（来自 P3 的 `/api/library/sections`）→ 一行轻量统计 |
| 货架 | 新组件 `Shelf`：横向滚动 + 隐藏滚动条（`no-scrollbar`）+ 「查看全部」跳转到已带筛选的分类页 |
| 媒体库 / 搜索 | 网格从 4:3 卡片换成 **2:3 海报墙**（列数 3→8 自适应）；列表视图重做为「小海报 + 一行元数据」的密集行（`MediaRow`），删掉旧的 `MediaCard` |
| 侧栏 | 重排：品牌区 + 导航（活跃项左侧品牌色指示条）+ 底部「主题 / 字体 / 连接状态」控制区；「Dashboard」改为「首页」 |

**没做（留给后续轮次，见 §4）**：分类页筛选器重做、详情页海报式布局、悬停操作（转发/在 TG 打开）、右键菜单、快捷键、隐私模式（P4-6）、应用图标、相册成组展示。

---

## 2. 可复现命令与原始输出

```bash
eval "$(fnm env --shell bash)"

# ---- 三件套（后端未改动，作为回归）----
$ pnpm -r typecheck
packages/shared typecheck: Done
apps/desktop typecheck: Done
apps/core typecheck: Done

$ pnpm -F @tma/core test
 Test Files  16 passed (16)
      Tests  128 passed (128)

$ pnpm -F @tma/core smoke
41/41 项通过

# ---- 前端产物 ----
$ pnpm -F @tma/desktop build:web
dist/assets/index-*.css   （含 LXGW WenKai @font-face，102 个 woff2 subset）
dist/assets/index-*.js    640.22 kB │ gzip: 198.31 kB
✓ built in 1.38s
dist 合计 6.0M

# ---- 死代码扫描（默认 tsconfig 未开 noUnusedLocals）----
$ pnpm -F @tma/desktop exec tsc --noEmit --noUnusedLocals --noUnusedParameters
(无输出 = 干净)
```

### 2.1 浏览器实机核验（Chrome + playwright-core）

脚本：`~/.workbuddy/binaries/node/workspace/verify-p4.mjs`（连演示 core 8788，11/11 通过）

```
  ✓ P4-1 深色优先（html.dark 已挂载）
  ✓ P4-1 默认字体为霞鹜文楷 — 'LXGW WenKai Screen', 'Geist Variable', sy
  ✓ P4-2 Hero 显示最新一条 — lesson material
  ✓ P4-2 首页有「最近归档」+ 分类货架 — 最近归档 / 剧集 / 动漫 / 图集 / 其他
  ✓ P4-1 海报卡（2:3）成排渲染 — 23 张
  ✓ P4-1 深色底已生效 — oklch(0.145 0.01 265)
  ✓ P4-1 媒体库改用海报墙 — 12 张
  ✓ P4-1 列表视图可用
  ✓ P4-1 侧栏有主题开关
  ✓ P4-1 浅色主题仍可切换
  ✓ P4-1 字体可切回 Geist — 'Geist Variable', system-ui, -
11/11 项通过
```

### 2.2 截图

| 文件 | 内容 |
|---|---|
| `docs/handoff/assets/P4/real/01-home.png` | **真实库**首页：Hero 大图 + 「最近归档」货架（真实海报、敏感锁角标、相册角标） |
| `docs/handoff/assets/P4/real/02-home-shelves.png` | 向下滚动后的分类货架 |
| `docs/handoff/assets/P4/real/03-library.png` | 媒体库海报墙（6 列 2:3） |
| `docs/handoff/assets/P4/real/04-detail.png` | 详情页（仍是旧布局，P4-4 重做） |
| `docs/handoff/assets/P4/01-home-hero-shelves.png` / `02..` / `03-library-poster-wall.png` / `04-library-list.png` | 演示库（8788，无缩略图）下的同页效果 |
| `docs/handoff/assets/P4/05-home-light.png` | 浅色主题（验证可切换且无破损） |

> ⚠ **审阅请用真实 core（8787）**：演示库是假 TG，下载不到缩略图，海报墙会是空占位（P2 起就如此，非缺陷）。
> 上面的 `real/` 截图即为真实库效果。

---

## 3. 验收清单（本轮范围）

- [x] **P4-1 视觉基调**：深色优先 + 浅色可切换；海报式卡片（2:3）；中文正文提供霞鹜文楷选项（默认开启，本地字体包）。
- [x] **P4-2 首页**：Hero（最新一条）+ 「最近归档」横向行 + 各分类夹横向行（电影/动漫/图集/成人…）。
- [x] **B10 暗色切换**：从「CSS 有变量但没接线」变成真的可切（`next-themes` + 侧栏开关）。
- [x] **B11 文楷字体**：已接入并可一键切回 Geist。
- [x] **一致性**：媒体库与搜索页统一为海报墙；旧 `MediaCard` 已删除（无死代码）。
- [x] **回归**：后端三件套全绿（128 单测 / 41 冒烟）；前端 typecheck + build + 实机 11/11。
- [ ] **用户在 Tauri 窗口实机审阅** ← **卡在这里**（本轮交付的意义就是请你先看）
- [ ] P4-3 分类页筛选/排序重做 · P4-4 详情页海报式布局 · P4-5 悬停操作与快捷键 · P4-6 隐私模式 · P4-7 B7/B12 收口

---

## 4. 已知问题与偏离 + 下一入口

### 偏离 / 判断

| 项 | 说明 |
|---|---|
| 首页取代 Dashboard | 原 `DashboardPage`（4 个统计卡 + 失败列表）已删除：媒体客户端不该以指标为中心。失败任务改为**只在有失败时**出现一条薄条（点进 Inbox），统计压成首页底部一行小字。 |
| 主题默认深色但保留 `enableSystem` | 用户确认「深色优先」，但给「跟随系统」留了口子；默认值写 `defaultTheme="dark"`。 |
| 字体默认文楷 | 用户偏好文楷（B11）。拉丁字符由 `Geist Variable` 兜底，中文走文楷。 |
| 列表视图改为带小海报 | 原列表只有文字，纯表格感；现在左侧 9×54 小海报 + 一行元数据，和海报墙互补。 |
| 分类页筛选器**暂未重做** | 现在还是 6 个下拉 + 2 个输入框横排（偏「后台」）。属 P4-3，放在下一轮，避免本轮改动面过大。 |

### 已知问题

1. **演示库无缩略图** → 演示环境海报墙是空占位。审阅请连真实 core（8787）；这也是 P2 起的既有事实。
2. **Hero 可能显示占位标题**（如「图片 #25」）：真实库有 5 条 `canonical_title` 为 null（`#7/#10/#18` 视觉拒答、`#24/#25` 被 purge）。属数据缺口，不是 UI 问题；`#24/#25` 做完人工分类后即可读。
3. **相册未成组展示**：P3 已有 `clusterByAlbum` 让同组相邻 + 角标，但海报墙上没有「折角/成组框」的视觉区分（P4-3）。
4. **左侧货架首屏卡片可能被内容区间距吃掉一点**：横向货架用 `-mx-1 px-1` 抵消内边距，RTL/窄窗口下需复看。
5. **首屏 Hero 图片用的是 TG 缩略图**（分辨率有限），放大后有轻微糊感。若需更清晰，得回到 Telegram 取更大尺寸（未做，成本/收益待评）。

### 下一入口（等你审阅反馈后决定顺序）

按任务书建议的推进顺序：**P4-3 分类页（分类夹内的海报网格 + 筛选/排序）→ P4-4 详情页 → P4-5 交互 → P4-6 隐私模式 → P4-7 收口**。
也可以按你实机看到的问题插队（例如先修某处观感、或先做隐私模式）。

**请你在 Tauri 窗口看一眼**（`pnpm -F @tma/desktop tauri dev`；桌面端默认连 8787 真实 core），
告诉我：哪些对、哪些不对、哪里最刺眼。我按反馈迭代，不做纯方案讨论。
