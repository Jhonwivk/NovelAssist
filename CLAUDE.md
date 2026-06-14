# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI 辅助小说创作系统（plan.md 是产品总纲）。面向长篇网文，核心壁垒：**Story Bible + 一致性引擎 + 长程记忆 + 运行时状态生成**。当前已落地 plan 阶段一/二/三/四 + 可视化 + 运行时状态模块；阶段五（鉴权/支付/协作/移动端）未做，本地写死单用户。

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

## 模型与配置（重要约束）

- AI 服务复用本机 Claude Code 配置：智谱 BigModel 的 Anthropic 兼容端点 `https://open.bigmodel.cn/api/anthropic` + Bearer token + 模型 `glm-5.2`。
- **坑**：Claude Code 的 `ANTHROPIC_MODEL=glm-5.2[1m]` 带方括号后缀，BigModel 报「模型不存在」，`scripts/use-claude-code-config.py` 用 `split('[')[0]` 去后缀。
- 该账号无 embedding 余额 → `app/embedding.py` 退回**本地字符 n-gram 哈希向量**（语义缓存/检索恒可用，零成本）。
- providers：`openai_compat.py` 覆盖 DeepSeek+OpenAI，`anthropic.py` 覆盖 Claude（支持 `auth_token` Bearer + 自定义 `base_url`）。

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
- lucide 图标名注意大小写：`RotateCw`（非 Rotatecw）等。
- **批量生成**：`POST /api/ai/outline/chapters`（总纲→N 章 title+outline JSON）+ `POST /api/ai/chapter/:id/generate`（`AiService.collectStream` 服务端消费 SSE 累积成文本 + `paragraphsToHtml` 落库）。前端 `components/batch-chapters-modal.tsx`。

## 代码约定（容易踩的）

- 后端小模块采用**单文件 module**写法（service+controller+`@Module` 在一个文件，如 `foreshadow/foreshadow.module.ts`）。**service 类必须加 `@Injectable()`**——曾因漏写导致 `this.prisma` 为 undefined、路由 500。
- TS：DTO 字段无初始值会触发 strict 报错，backend `tsconfig.json` 已设 `strictPropertyInitialization: false`。
- Prompt 集中在 `ai-service/app/prompts.py`，便于缓存/迭代；改 prompt 后非流式端点会自动受益于语义缓存。
- 前端工作台 `apps/frontend/app/novels/[id]/page.tsx` 是标签页式面板中枢（设定/大纲/AI助手/灵感/一致性/伏笔/物品/地点/关系图/时间线/成本）；编辑器右侧「运行时」三子标签在 `components/chapter-editor.tsx`。
- 中文文件名导出走 RFC 5987 `filename*=UTF-8''…`（`export.controller.ts`），否则 HTTP header 报非法字符。

## 启动后验证

`curl localhost:3001/api/health`、`curl localhost:8000/health`（应返回 `providers:["anthropic"]`、`embedding:true`、`cache_enabled:true`）。无 LLM key 时 CRUD/编辑器/导出照常，AI 给清晰降级提示（流式→SSE error，JSON→502）。
