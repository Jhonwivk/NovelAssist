# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI 辅助小说创作系统（plan.md 是产品总纲）。面向长篇网文，核心壁垒：**Story Bible + 一致性引擎 + 长程记忆 + 运行时状态生成**。当前已落地 plan 阶段一/二/三/四 + 可视化 + 运行时状态模块；阶段五（鉴权/支付/协作/移动端）未做，本地写死单用户。已有 **Electron 桌面客户端**（`desktop/`，打包 3 服务为单个 .app/.exe，见下）。

## Commands

```bash
# 一次性环境
corepack enable
pnpm install
cd apps/ai-service && uv sync && cd ../..
python3 scripts/use-claude-code-config.py   # 从 ~/.claude/settings.json 同步 LLM 配置到 apps/ai-service/.env
pnpm db                                      # prisma migrate dev（SQLite）

# 运行
pnpm dev          # backend(3001) + frontend(3000)
pnpm dev:all      # backend + ai-service(8000) + frontend（推荐）
pnpm ai           # 仅 ai-service
pnpm db:studio    # Prisma Studio 看数据

# 构建 / 类型检查（改完代码必跑）
pnpm --filter backend exec nest build
pnpm --filter frontend exec next build
cd apps/ai-service && uv run python -c "import app.main"   # ai-service 语法检查

# 桌面客户端（Electron · 自包含：bundle Node+Python，详见下文「桌面客户端」节）
pnpm desktop:build       # 跑 desktop/build.cjs all：staging 到 desktop/.stage/（backend/frontend/python/node/env）
pnpm desktop:stage:<x>   # 单独重跑某步（backend|frontend|python|node|env），便于缓存
pnpm desktop:dev         # 系统运行时 + repo 路径直接 electron 启动（开发用）
pnpm app:build           # desktop:build + electron-builder 出 dmg/zip（自包含，双击即用）
```

## Architecture（三服务 monorepo，无 Docker）

```
frontend (Next.js+TipTap, 3000) ──HTTP/SSE──> backend (NestJS+Prisma, 3001) ──HTTP/SSE──> ai-service (FastAPI+uv, 8000) ──> 云端 LLM
```

- **backend** 是 BFF：所有 CRUD + AI 代理 + 一致性引擎 + 记忆/运行时。AI 流式端点用 Node 全局 `fetch` 逐字节透传 ai-service 的 SSE（`ai/ai.service.ts` 的 `streamRequest`），同时写 `AiTask` 日志。
- **ai-service** 无状态：模型抽象层 + 分级路由 + Prompt + 语义缓存。**不连数据库**，所有上下文由 backend 组装后传入。
- **frontend** 纯客户端渲染（App Router，页面基本都 `'use client'`），用 TanStack Query + `fetch`+`ReadableStream` 消费 SSE（非 EventSource，因为要 POST）。

### 关键数据流：写一章
1. 编辑器 TipTap → debounce 自动保存 `PUT /api/chapters/:id`（`wordCount` 后端按中文字符计）。
2. 点「生成本章」→ `POST /api/ai/chapter` → backend `memory.assembleContext()` 组装上下文（分层记忆 L1-L4 + Bible 实体 + **运行时状态快照**）→ 透传 ai-service `/chapter` → GLM 流式回填编辑器。
3. 点「分析本章」→ `POST /api/consistency/check/:id` → L1 事实抽取（写 Entity/Event/Relation/EntityState/Information/Foreshadow）→ L2 规则 → L3 图谱 → L4 LLM → 落 `ConsistencyIssue` → `GET /api/consistency/changes/:id` 展示。
4. 保存后前端空闲 30s 自动 `POST /api/chapters/:id/analyze`（**fire-and-forget**：后台跑一致性检查 + `memory.summarizeChapter`，立即返回，不阻塞保存；`chapters.controller.ts`）。
5. 一致性问题「AI 一键修复」→ `POST /api/consistency/issues/:id/fix` → `fixIssue()` 从 `issue.location` JSON 取 chapterId → 调 ai-service `/fix-issue` 改写 evidence → **改前先存 `ChapterSnapshot`（reason `pre-fix`，可回滚）** → 替换 HTML 正文 + 重算字数 + 标记 resolved → 修复后再 fire-and-forget 复查是否引入新矛盾。

## 模型与配置（重要约束）

- AI 服务复用本机 Claude Code 配置：智谱 BigModel 的 Anthropic 兼容端点 `https://open.bigmodel.cn/api/anthropic` + Bearer token + 模型 `glm-5.2`。
- **坑**：Claude Code 的 `ANTHROPIC_MODEL=glm-5.2[1m]` 带方括号后缀，BigModel 报「模型不存在」，`scripts/use-claude-code-config.py` 用 `split('[')[0]` 去后缀。
- 该账号无 embedding 余额 → `app/embedding.py` 退回**本地字符 n-gram 哈希向量**（语义缓存/检索恒可用，零成本）。
- providers：`openai_compat.py` 覆盖 DeepSeek+OpenAI，`anthropic.py` 覆盖 Claude（支持 `auth_token` Bearer + 自定义 `base_url`）。
- **运行时配置面板**（主页）：`GET/POST /api/config` → backend `ai/config.controller.ts` 透传 ai-service `/config`。POST 直接**改写 `apps/ai-service/.env` 并 `os.utime` 触碰 `.py` 触发 uvicorn `--reload` 热重载**（仅 `uv run --reload` 启动时生效，桌面/生产模式不会热重载）。

## 数据层约定

- **SQLite，无 Docker，无 Redis**（SSE 进程内；Celery 未引入）。生产目标 Postgres+pgvector，切换只改 datasource。
- SQLite 不支持 enum/Json：枚举用 String + 应用层校验；结构化字段（`Entity.attributes`/`aliases`、`Novel.meta`、`Relation.attributes`、`Memory.embedding` 等）用 **String 存 JSON，service 层 `JSON.parse/stringify`**（参考 `bible.service.ts` 的 `toDto`/`safeParse`）。
- Prisma schema 是产品核心资产（`apps/backend/prisma/schema.prisma`），面向全量 Story Bible 抽象设计；改 schema 后 `pnpm db`。

## 核心子系统（big picture，跨多文件）

- **一致性引擎五层**（`consistency/consistency.service.ts`）：L1 抽取(`extractAndStore`) → L2 确定性规则(`l2Rules`：已死角色行动/修为倒退/道具持有者已死/销毁道具再现) → L3 图谱(`l3Graph`：关系冲突/因果链断裂) → L4 LLM 语义 → L5 反馈(`resolveIssue` 调 `Rule.weight`)。L1 抽取的 JSON schema 在 `ai-service/app/prompts.py` 的 `_EXTRACT_SYSTEM`（字段：state_changes/events[+causes]/new_entities/relation_changes[+strength]/foreshadow_triggers/character_states/item_transfers/information_changes）。
- **运行时状态快照**（`ai/runtime.service.ts`）：写章前按 `Chapter.sceneConfig` 的出场角色，生成「截至上一章末」的状态/已知·不知/关系切片/最近事件/物品持有/因果/伏笔快照，`render()` 成块注入章节 Prompt（由 `ai/memory.service.ts` 的 `assembleContext` 自动附加）。**信息流「谁知道什么」（`Information` 表）是防剧透核心**。
- **长程记忆**（`ai/memory.service.ts`）：分层 L1-L4 + 词法检索（字符 n-gram，无向量依赖）+ token 预算组装。
- **模型路由缓存**（`ai-service/app/cache.py`）：非流式端点按输入嵌入命中复用；流式创作端点不缓存。

## 前端 UI（Linear/Vercel 极简专业 · 设计系统 v2）

- **暗色为默认**：`<html class="dark">` + 无闪烁脚本（layout.tsx）+ `components/theme-toggle.tsx` 切换（localStorage `na-theme`）。token 在 `app/globals.css` 的 CSS 变量（`.dark`/`.light`），含 spacing/radius/字号/elevation/ring/zIndex 缩放（tailwind.config.ts）。
- **用语义 token，不要写裸色**：`bg/surface/surface-2/surface-3/border/line/fg/fg-muted/fg-faint/primary/primary-soft/accent/warn/danger/info`。**禁止** `bg-white`/`text-gray-*`/`ink-*`/emoji-as-icon——用 lucide-react 图标。
- **组件库在 `components/ui.tsx`（单一 barrel）**：Button(size/loading/icon)、IconButton、TextInput/TextArea(error/icon)、Label、Card(variant flat/outline/elevated/sunken)、Badge(tone)、Chip、Avatar、Skeleton/SkeletonCard、EmptyState、ProgressBar、Switch、Select、Tooltip、Tabs(统一)、SegmentedControl、Menu、Modal(portal+Esc)、ConfirmProvider/useConfirm、Breadcrumb、NavItem、Stat、Disclosure、Spinner、toast(re-export sonner)。**复用这些，别手搓卡片/tab**。
- **全局外壳** `components/app-shell.tsx`：`AppShell`（顶栏 brand+面包屑+主题+头像 + 内容容器）用于非编辑器页；编辑器维持自有沉浸顶栏。toast/Confirm 在 `app/providers.tsx`。
- 编辑器三栏（`components/chapter-editor.tsx`）：顶栏面包屑+保存spinner + 左章节树(lucide 状态图标) + 中央 TipTap + 右 `Tabs`(AI/状态/问题/速查) + 选中文本浮动工具栏(lucide+Tooltip)。内联标记 `components/editor-marks.ts`。
- **坑1**：改前端依赖后若 500 报 `Cannot find module './vendor-chunks/...'` → `rm -rf apps/frontend/.next` 重启。
- **坑2**：layout 设了 `export const dynamic = 'force-dynamic'`（所有页面客户端数据驱动，跳过静态预渲染；否则 `/` 静态生成可能超时）。
- **坑3**：G6 颜色必须读 CSS 变量（`themeColors()` in `visualization.tsx`）+ MutationObserver 监听主题切换重建，否则明暗主题下颜色错。
- **坑4**（曾导致桌面端开 app 即白屏 500）：**Server Component 不能把组件 ref 当 prop 传给 Client Component**（如 `<Button icon={Plus}>`，`Plus` 是 lucide 的 `forwardRef`）。Server→Client 边界只允许序列化值；`icon={<Plus/>}`（元素，可序列化）才安全，`icon={Plus}`（组件 ref）会报 `Functions cannot be passed directly to Client Components`。`next dev` 下不易察觉，但 `next start`（桌面端 `desktop/main.cjs` 用的就是它）SSR 时**整站 500**——因为根 `app/not-found.tsx` 被嵌入每个路由的 RSC payload，一处不可序列化即全部炸。修法：给该文件加 `'use client'`，或改成传元素。判断：任何缺 `'use client'` 的 `app/*.tsx` 若传 `icon={X}`/`as={X}`/`component={X}` 就有此坑。
- lucide 图标名注意大小写：`RotateCw`（非 Rotatecw）等。
- **批量生成**：`POST /api/ai/outline/chapters`（总纲→N 章 title+outline JSON）+ `POST /api/ai/chapter/:id/generate`（`AiService.collectStream` 服务端消费 SSE 累积成文本 + `paragraphsToHtml` 落库）。前端 `components/batch-chapters-modal.tsx`。**接续**：`outlineChapters` 会把已有章节（标题+摘要，`ai.controller.ts`）传给 ai-service；prompt（`prompts.py` 的 `outline_chapters`）在有 `existingChapters` 时走「接着第 N 章往后、严禁重复已写节点」分支，否则从总纲开头拆（新书）。

## 代码约定（容易踩的）

- 后端小模块采用**单文件 module**写法（service+controller+`@Module` 在一个文件，如 `foreshadow/foreshadow.module.ts`）。**service 类必须加 `@Injectable()`**——曾因漏写导致 `this.prisma` 为 undefined、路由 500。
- TS：DTO 字段无初始值会触发 strict 报错，backend `tsconfig.json` 已设 `strictPropertyInitialization: false`。
- Prompt 集中在 `ai-service/app/prompts.py`，便于缓存/迭代；改 prompt 后非流式端点会自动受益于语义缓存。
- 前端工作台 `apps/frontend/app/novels/[id]/page.tsx` 是标签页式面板中枢（设定/大纲/AI助手/灵感/一致性/伏笔/物品/地点/关系图/时间线/成本）；编辑器右侧「运行时」三子标签在 `components/chapter-editor.tsx`。
- 中文文件名导出走 RFC 5987 `filename*=UTF-8''…`（`export.controller.ts`），否则 HTTP header 报非法字符。
- 嵌套资源若前端要按 id 直连，加一个**独立项 controller**（不依赖父参数），如 `volumes.controller.ts` 的 `VolumesItemController`（`PATCH/DELETE /volumes/:id`）与 `VolumesController`（`/novels/:novelId/volumes`）并存，二者都要在 module 的 `controllers` 注册。
- `volumeId` 允许置空（章节移出分卷）：DTO 用 `@ValidateIf((o) => o.volumeId !== null)` 放行 `number | null`（`create-chapter.dto.ts`）。

## 桌面客户端（Electron · 自包含打包）

`pnpm app:build` 产出一个**自包含** `.app`（双击即用，目标机无需 node/python）——bundle 了独立 Node 22 + 可重定位 Python 3.12（python-build-standalone）+ 三个服务，可写状态全落 `app.getPath('userData')`（=`~/Library/Application Support/novel-assist`，注意目录名取自 package.json `name=novel-assist`，非 productName）。

- **staging 编排** `desktop/build.cjs`（被 `package.json` 的 `desktop:stage:*`/`desktop:build` 调用，产物在 `desktop/.stage/`，已 gitignore）：
  - `backend`：拷 dist+prisma → `npm install --omit=dev`（**必须用 npm 产扁平、无符号链接的 node_modules**；pnpm deploy 的 `.pnpm` 符号链接布局会被 electron-builder 整个丢掉）→ `prisma generate`（deploy 不带生成的 client+engine，必须补）→ `prisma migrate deploy` 生成 `db/template.db` → **整个 backend 打成 `backend.tar.gz`**。
  - `frontend`：`next build`（`output:'standalone'`）→ 拷整棵 standalone + 补 `.next/static` 到 `apps/frontend/.next/static` → 打成 `frontend.tar.gz`。
  - `python`：`uv python install/find 3.12` → 拷**解释器根**（非 `.venv`，其 `pyvenv.cfg home=` 指向构建机不可重定位）→ `uv pip install --break-system-packages`（python-build-standalone 带 `EXTERNALLY-MANAGED`）装依赖进 base 解释器 site-packages。
  - `node`：下载 Node 22 LTS darwin-arm64 tarball 到 `desktop/.stage/node/`。
  - `env`：写 `default.env`（空密钥模板）。
- **electron-builder 会过滤 extraResources 里任何 `node_modules` 目录**（无论符号链接/扁平）→ 所以 backend/frontend 以 `tar.gz` 发布，运行时由 `main.cjs` 解压到 userData（backend 从 userData 跑，`node_modules` 正常向上查找解析；无需 NODE_PATH）。
- `desktop/main.cjs`（主进程，asar 里仅此 + package.json，~10KB）：`app.whenReady` → `firstRunSetup`（同步 `execSync tar -xzf` 解压 backend/frontend 到 userData + 拷 template.db/default.env）→ `spawn` backend(`bundled-node dist/main.js`)+ai(`bundled-python -m uvicorn`,cwd=userData,PYTHONPATH=Resources/ai-service,`PYTHONDONTWRITEBYTECODE=1`,`NA_ENV_FILE=userData/.env`)+frontend(`bundled-node standalone/server.js`)→ `waitFor(frontend)` 开窗。config 热重载：`fs.watchFile`(非 `fs.watch`，后者对 macOS 单文件原地重写不可靠)监听 `.env` → 重启 ai 进程。调试日志写 `userData/main-debug.log`（GUI 启动拿不到 stdout）。**坑**：`USER = app.getPath('userData')` 必须在引用它的 `BACKEND_DIR` 之前声明，否则顶层 TDZ `ReferenceError` 让 whenReady 永不触发（静默白屏）。**升级**：`firstRunSetup` 用 bundled `backend.tar.gz` 的 mtime 作版本戳（`userData/.code-version`），重新打包后 mtime 变 → 自动重解压 backend/frontend，新代码即时生效（否则 userData 里旧解压代码不会被覆盖）。
- **坑**：`desktop/builder.yml` 引用 `desktop/icon.icns/.ico/.png` 但仓库无图标文件 → 用 Electron 默认图标（功能不受影响）；要自定义图标需补这三个文件。应用未签名（无 Developer ID）→ 首次双击可能需右键→打开（Gatekeeper）；真·任意 Mac 免提示需 notarize（未来工作）。
- `pnpm desktop:dev`（开发）走系统 node/uv/npx + repo 路径，与打包分支隔离。

## 启动后验证

`curl localhost:3001/api/health`、`curl localhost:8000/health`（应返回 `providers:["anthropic"]`、`embedding:true`、`cache_enabled:true`）。无 LLM key 时 CRUD/编辑器/导出照常，AI 给清晰降级提示（流式→SSE error，JSON→502）。打包 app：`open desktop/dist/mac-arm64/NovelAssist.app` 后同样 curl 三个端口；首启会在 userData 解压 backend/frontend（~7s）并建库。
