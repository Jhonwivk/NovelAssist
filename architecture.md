# NovelAssist 架构说明（实际实现版）

> 本文档描述系统**当前实际落地**的实现状态，由代码逐文件梳理得出，**不代表 plan.md 的设计意图**。
> plan.md / README 为早期设计，部分功能未实现或与现状不符，定位问题时以本文档为准。
> 生成日期：2026-06-17 ｜ 维护建议：改动端点 / UI 控件 / 数据模型后同步更新本文件。

---

## 0. 一句话概述

三服务 monorepo（无 Docker）：`frontend(3000) → backend(3001) → ai-service(8000) → 云端 GLM`。
backend 是 BFF（所有 CRUD + AI 代理 + 一致性引擎 + 长程记忆 + 运行时状态），ai-service 无状态（模型抽象 + Prompt + 缓存），frontend 纯客户端渲染。当前写死单用户，无鉴权/支付/协作。

---

## 1. 系统拓扑与服务职责

```
┌──────────────┐  HTTP/SSE  ┌───────────────┐  HTTP/SSE  ┌────────────────┐  HTTPS
│  frontend    │ ─────────> │   backend     │ ─────────> │   ai-service   │ ──────> 云端 LLM
│ Next.js 3000 │            │ NestJS 3001   │            │ FastAPI 8000   │   (GLM via BigModel
│ TipTap+TQuery│ <───────── │ Prisma+SQLite │ <───────── │ uv / 无状态     │    Anthropic 兼容端点)
└──────────────┘            └───────────────┘            └────────────────┘
```

| 服务 | 技术栈 | 职责 | 是否连库 |
|---|---|---|---|
| frontend | Next.js App Router, TipTap, TanStack Query | 纯客户端渲染；用 `fetch`+`ReadableStream` 消费 SSE（非 EventSource，因需 POST） | 否 |
| backend | NestJS, Prisma, SQLite | BFF：CRUD、AI 代理透传、一致性引擎 L1-L5、长程记忆 L0-L4、运行时状态快照、版本快照、导出 | 是（唯一） |
| ai-service | FastAPI, uv, anthropic/openai SDK | 无状态：模型分层路由(small/medium/large)、Prompt 集中管理、语义缓存、本地 embedding 降级 | 否 |

**关键约束**：ai-service 不连库，所有上下文由 backend 的 `memory.assembleContext()` 组装后传入。

---

## 2. 端到端数据流（核心场景）

### 2.1 写一章（流式）
1. 编辑器 TipTap → debounce(1.5s) 自动保存 `PUT /api/chapters/:id`（`wordCount` 后端按中文字符计）。
2. 「生成本章」→ `POST /api/ai/chapter` → backend `memory.assembleContext()`（分层记忆 L1-L4 + Bible 实体 + 运行时状态快照）→ 透传 ai-service `/chapter` → GLM 流式逐字回填编辑器（`streamRequest` 字节透传）。
3. 「查问题/分析本章」→ `POST /api/consistency/check/:id` → L1 抽取 → L2 规则 → L3 图谱 → L4 LLM → 落 `ConsistencyIssue`。
4. 保存后前端空闲 30s 自动 `POST /api/chapters/:id/analyze`（**fire-and-forget**：后台跑一致性检查 + `memory.summarizeChapter`，立即返回）。
5. 一致性问题「AI 一键修复」→ `POST /api/consistency/issues/:id/fix` → 先存 `ChapterSnapshot(reason=pre-fix)` → 调 ai-service `/fix-issue` 改写 evidence → 替换正文 + 重算字数 + 标记 resolved → 复查。

### 2.2 上下文组装（`ai/memory.service.ts assembleContext`，字符预算≈12000）
| 部分 | 权重 | 来源 |
|---|---|---|
| bookSummary (L4) | 12% | Novel.bookSummary |
| volumeOutline | 8% | Volume.outline |
| prevSummary | 12% | 上一章 ChapterSummary(L2) |
| recentSummaries | 18% | 最近若干章 L2 |
| characters | 22% | Bible 实体 |
| retrieved | 20% | 词法检索（字符 n-gram，无向量依赖）top-k |
| chapterOutline | 8% | 本章 outlineText |
| + 运行时快照 | (附加) | `runtime.service.ts snapshot()`，预算≈3200 |

### 2.3 运行时状态快照（`ai/runtime.service.ts`，防剧透核心）
按 `Chapter.sceneConfig` 出场角色，生成「截至上一章末」的：角色状态/已知·不知（`Information` 表「谁知道什么」）/关系切片/最近事件/物品持有/因果/伏笔，`render()` 成块注入 Prompt。

---

## 3. 数据模型（Prisma · SQLite）

> SQLite 不支持 enum/Json：枚举用 String + 应用层校验；结构化字段用 **String 存 JSON**，service 层 `JSON.parse/stringify`（参考 `bible.service.ts` 的 `toDto`/`safeParse`）。

### 3.1 已激活表（有读写逻辑）
| 表 | 关键字段 | JSON-as-String 字段 |
|---|---|---|
| **Novel** | title, genre, synopsis, worldviewText, masterOutline, bookSummary(L4), status, wordCount | `meta`{theme,trope,coreSetting,audience,templateName} |
| **Volume** | novelId, title, order, summary, outline | — |
| **Chapter** | novelId, volumeId?, title, order, status, content(HTML), outlineText, wordCount | `sceneConfig`{characterIds[],locationIds[],itemIds[],goals[]} |
| **Entity** | novelId, type(character/location/organization/item/power_system/worldview), name, description, parentId | `aliases`[], `attributes`{} |
| **ChapterSummary** | chapterId@unique, level(L1-L4) | `content` |
| **ChapterSnapshot** | chapterId, content, wordCount, reason(manual/autosave/ai/pre-rollback/pre-fix) | — |
| **AiTask** | novelId?, chapterId?, type, status, model?, tokensIn/Out, cached, error | — |
| **EntityState** | entityId, chapterId, attrName, value, evidence（跨章节属性追踪） | — |
| **Event** | novelId, chapterId, type, location, result | `participants`[], `causes`[] |
| **Relation** | novelId, subjectId, objectId, type, validFromChapter, validToChapter | `attributes`（仅用了 strength） |
| **Foreshadow** | novelId, title, setupChapter, payoffChapter, status(setup/paid_off/abandoned), description | — |
| **Information** | novelId, content, importance(core/normal/minor), sourceEventId | `knowers`[{entityId,sinceChapter}] |
| **ConsistencyIssue** | novelId, layer, severity, type, evidence, conflictWith, suggestion, confidence, autoFixable, status | `entities`, `location`{chapterId,paragraph,charOffset} |
| **Rule** | novelId, name, layer(L1-L4), enabled, weight（L5 反馈调整） | — |
| **StyleProfile** | novelId@unique | `traits`, `bannedWords`, `samples` |
| **NovelTemplate** | name, genre, theme, trope, coreSetting, audience, synopsisHint, worldviewSkeleton, isBuiltin | — |

### 3.2 占位/弱使用
- **Memory** 表：`embedding` 字段留空（阶段二 pgvector）；L3 卷摘要 `refreshVolume()` 存在但**无端点暴露、从不调用**。
- **Relation.attributes / Event.storyTime**：半使用，仅 conflicts 检测用到 storyTime。

---

## 4. 后端 API（全局前缀 `/api`，端口 3001）

> 流式端点用 `AiService.streamRequest`（SSE 字节透传，不解析）；批量生成用 `collectStream`（服务端累积 token 后落库）；非流式 JSON 用 `jsonRequest/loggedJson`（写 AiTask 日志）。

### 4.1 CRUD
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST/GET/GET/PATCH/DELETE | `/novels` `/novels` `/novels/:id` `/novels/:id` `/novels/:id` | 小说 CRUD（级联删除） |
| POST/GET/PATCH/DELETE | `/novels/:novelId/volumes` ... | 分卷（含独立项 `PATCH/DELETE /volumes/:id`） |
| POST/GET | `/novels/:novelId/chapters` | 章节创建/列表 |
| GET/PUT/PATCH/DELETE | `/chapters/:id` | 单章查询/保存(PUT)/更新/删除 |
| POST | `/chapters/:id/analyze` | fire-and-forget：L1 抽取+一致性+摘要 |
| GET/POST/PATCH/GET/DELETE | `/novels/:novelId/bible`,`/items`,`/entities`,`/entities/:id`,`/entities/:id/trajectory` | 实体库 + 物品栏 + 轨迹 |

### 4.2 AI 生成（`/ai/*`）
| 方法 | 路径 | 流式 | 说明 |
|---|---|---|---|
| POST | `/ai/outline` `/ai/outline/optimize` | 否 | 总纲生成/优化 |
| POST | `/ai/outline/chapters` | 否 | 批量章节计划（接续已有章节） |
| POST | `/ai/idea` `/ai/title` `/ai/synopsis` `/ai/hook` | 否 | 灵感/书名/简介/钩子 |
| POST | `/ai/chapter` | **是** | 生成本章（assembleContext + streamRequest） |
| POST | `/ai/chapter/:chapterId/generate` | 否(服务端消费) | 生成并立即落库（批量用，collectStream） |
| POST | `/ai/continue` `/ai/polish` `/ai/expand` `/ai/rewrite` `/ai/viewpoint` `/ai/style-switch` | **是** | 续写/润色/扩写/改写/视角/文风 |
| POST | `/ai/chat` | **是** | 对话（带上下文） |
| POST | `/ai/review` | 否 | 审稿 |

### 4.3 记忆 / 配置 / 一致性 / 伏笔 / 时间线 / 文风 / 版本 / 模板 / 成本 / 导出
| 方法 | 路径 | 说明 |
|---|---|---|
| POST/POST/GET | `/memory/summarize/:chapterId` `/memory/book/:novelId` `/memory/context` | L2 摘要 / 全书 L4 刷新 / **调试**：查看组装上下文 |
| GET/POST | `/config` | 读/写 ai-service 配置（透传） |
| POST/GET/GET/POST/POST | `/consistency/check/:chapterId` `/consistency/issues` `/consistency/changes/:chapterId` `/consistency/issues/:id/resolve` `/consistency/issues/:id/fix` | 检查/问题列表/本章变化/反馈(L5)/AI修复 |
| GET/GET/POST/POST/DELETE | `/novels/:novelId/foreshadows`(+`/reminders`) `/foreshadows/:id` | 伏笔 CRUD + 提醒 |
| GET | `/novels/:novelId/timeline`(+`/conflicts` `/graph`) | 事件 / 冲突 / 关系图(G6) |
| GET/PUT/POST | `/novels/:novelId/style`(+`/guard`) | 文风获取/保存/守卫 |
| POST/GET/GET/POST | `/chapters/:id/snapshot` `/snapshots` `/diff` `/rollback/:snapshotId` | 版本快照/列表/diff(LCS)/回滚 |
| GET/POST/DELETE | `/templates` | 设定模板（内置不可删） |
| GET | `/stats/cost` | Token 成本看板 |
| GET | `/export/novels/:id?format=txt\|md\|docx\|epub` | 导出（中文名走 RFC5987） |

---

## 5. ai-service（端口 8000，无状态）

### 5.1 端点分类
- **非流式 JSON（可命中语义缓存）**：`/outline` `/outline/optimize` `/outline-chapters`(→JSON) `/idea` `/title` `/synopsis` `/hook` `/summarize` `/summarize-book` `/extract`(→JSON) `/consistency-check`(→JSON) `/review`(→JSON) `/style-guard`(→JSON) `/fix-issue`
- **流式 SSE（不缓存）**：`/chapter` `/continue` `/polish` `/expand` `/rewrite` `/viewpoint` `/style-switch` `/chat`
- **工具**：`/health` `/config`(GET/POST) `/embed` `/cache-stats`

SSE 格式：`data: {"token":"..."}` 逐条，结束 `data: [DONE]`，异常 `event: error`。

### 5.2 Prompt（集中于 `prompts.py`）
- `WRITER_SYSTEM`：创作类统一系统提示（遵循设定、不臆造冲突）。
- `_EXTRACT_SYSTEM`（L1 抽取 JSON schema）：`state_changes / events[+causes] / new_entities / relation_changes[+strength] / foreshadow_triggers / character_states / item_transfers / information_changes`。
- `outline_chapters`：有 `existingChapters` 时走「接着第 N 章往后、严禁重复」分支（`prompts.py:69-94`，`.format` 转义正确）；无则从总纲开头拆。
- `consistency_check`(_CHECK_SYSTEM)：软矛盾；`review`(_REVIEW_SYSTEM)：score/typos/rhythm/hooks/emotion_curve；`style_guard`(_STYLE_GUARD_SYSTEM)。

### 5.3 模型路由 / 缓存 / 配置
- **路由**（`router.py`）：tier(small/medium/large) → `PROVIDER_{tier}`/`MODEL_{tier}`；provider 不可用回退首个可用 provider 的 default_model；无可用 → 503。
- **当前配置**：三 tier 全部 `anthropic` / `glm-5.2`，经 BigModel Anthropic 兼容端点 `https://open.bigmodel.cn/api/anthropic` + Bearer。
- **缓存**（`cache.py`）：仅非流式端点；按输入 embedding 的 cosine≥0.97 命中；每 task_type 最多 200 条 FIFO。
- **embedding**（`embedding.py`）：优先云端 embedding-3，不可用降级**本地字符 n-gram 哈希向量**（1024 维），进程内固定模式。
- **配置热重载**：`POST /config` 改写 `.env` + `os.utime` 触碰 `.py` → `uv run --reload` 热重载（桌面/生产模式改写 `$NA_ENV_FILE` 由 Electron 重启子进程）。
- **坑**：`glm-5.2[1m]` 方括号后缀须去除（`scripts/use-claude-code-config.py` 用 `split('[')[0]`）。

---

## 6. 前端（端口 3000）

API base：`NEXT_PUBLIC_API_URL || http://localhost:3001/api`（`lib/api.ts`）；`streamSse()` 手动解析 SSE。

### 6.1 路由
| 路由 | 文件 | 用途 |
|---|---|---|
| `/` | `app/page.tsx` | 作品库 + 统计 + API 配置卡 + 导出 |
| `/novels/new` | `app/novels/new/page.tsx` | 新建（模板选择 + 表单 + 存为模板） |
| `/novels/[id]` | `app/novels/[id]/page.tsx` | 工作台（12 标签页中枢） |
| `/novels/[id]/chapters/[cid]` | `components/chapter-editor.tsx` | 三栏编辑器 |

### 6.2 工作台 12 标签
`章节(内联)` `设定(BiblePanel)` `大纲(OutlinePanel)` `AI助手(AiChat)` `灵感(IdeaTools)` `一致性(ConsistencyPanel)` `伏笔(ForeshadowPanel)` `物品(ItemPanel)` `地点(LocationPanel)` `关系图(RelationshipGraph/G6)` `时间线(TimelineView)` `成本(CostPanel)`。

### 6.3 编辑器三栏
- 左：章节树（按卷分组，状态图标，点击切章）。
- 中：TipTap（标题/章纲/出场角色 chip/目标；onUpdate debounce 保存）。
- 右 4 子标签：`AI`（生成本章/续写/摘要/查问题/快照/完成本章 + 历史回滚）、`状态`（运行时角色状态/物品/信息约束）、`问题`（分析本章 + issue 卡）、`速查`（BibleLookup）。
- 选中文本浮动工具栏：润色/扩写/改写/视角。

### 6.4 可点击控件 → API 全量映射（Phase 2 核对清单）
| 位置 | 控件 | 方法 | 端点 |
|---|---|---|---|
| `/` | 导出 TXT/MD | GET | `/export/novels/{id}?format=txt\|md` |
| `/` | 删除作品 | DELETE | `/novels/{id}` |
| `/` | API 配置·保存并热重载 | POST | `/config` |
| `/novels/new` | 删除模板 | DELETE | `/templates/{id}` |
| `/novels/new` | 创建并生成大纲 | POST | `/novels` |
| `/novels/new` | 保存为模板 | POST | `/templates` |
| `/novels/[id]` | 导出 TXT/MD/DOCX/EPUB | GET | `/export/novels/{id}?format=...` |
| `/novels/[id]` | 重命名作品 | PATCH | `/novels/{id}` |
| `/novels/[id]` | 创建并编辑（章节） | POST | `/novels/{id}/chapters` |
| `/novels/[id]` | 重命名/移卷章节 | PUT | `/chapters/{id}` |
| `/novels/[id]` | 删除章节 | DELETE | `/chapters/{id}` |
| `/novels/[id]` | 新建卷/重命名卷/删除卷 | POST/PATCH/DELETE | `/novels/{id}/volumes`,`/volumes/{id}` |
| 大纲 | 生成/优化/保存总纲 | POST/POST/PATCH | `/ai/outline`,`/ai/outline/optimize`,`/novels/{id}` |
| 批量弹窗 | 生成章节计划 | POST | `/ai/outline/chapters` |
| 批量弹窗 | 全部创建 / 创建并生成正文 | POST(+POST) | `/novels/{id}/chapters`(+`/ai/chapter/{id}/generate`) |
| 编辑器·AI | 生成本章/续写 | POST SSE | `/ai/chapter`,`/ai/continue` |
| 编辑器·AI | 摘要/查问题/快照/完成本章 | POST | `/memory/summarize/{id}`,`/consistency/check/{id}`,`/chapters/{id}/snapshot`,`/chapters/{id}/analyze` |
| 编辑器·历史 | 回滚 | POST | `/chapters/{id}/rollback/{snapshotId}` |
| 编辑器·浮动 | 润色/扩写/改写/视角 | POST SSE | `/ai/polish\|expand\|rewrite\|viewpoint` |
| 一致性 | 检查最新章/AI修复/已修正·有意·忽略 | POST | `/consistency/check/{id}`,`/issues/{id}/fix`,`/issues/{id}/resolve` |
| 灵感 | 生成(idea/title/synopsis/hook) | POST | `/ai/idea\|title\|synopsis\|hook` |
| 灵感 | 设为简介/加入总纲/用这个书名 | PATCH | `/novels/{id}` |
| AI助手 | 发送 | POST SSE | `/ai/chat` |
| 伏笔 | 标记已回收/添加 | POST | `/foreshadows/{id}`,`/novels/{id}/foreshadows` |
| 物品/地点 | 添加 | POST | `/novels/{id}/entities` |
| 设定 | 保存世界观/添加角色/删除/轨迹 | PATCH/POST/DELETE/GET | `/novels/{id}`,`/entities`,`/entities/{id}`,`/entities/{id}/trajectory` |

### 6.5 三种生成模式
| 模式 | 入口 | 流程 |
|---|---|---|
| **a. 一章一章** | 编辑器·AI·生成本章 | SSE `/ai/chapter` 逐字回填 → flush 保存 |
| **b. 批量** | 工作台·批量生成 | `/ai/outline/chapters` 出计划 → 循环 `createChapter`（+可选 `/ai/chapter/{id}/generate` 落库） |
| **c. 一次生成一本** | **无专用入口** | 现状靠「批量生成」+ 勾选「创建后自动生成正文」近似实现；无整书一键端点 |

---

## 7. 运行与配置

```bash
pnpm dev:all      # backend + ai-service(8000) + frontend（推荐）
pnpm db           # prisma migrate dev
# 验证：curl localhost:3001/api/health ；curl localhost:8000/health
#       （后者应 providers:["anthropic"], embedding:true, cache_enabled:true）
```
环境变量：`DATABASE_URL`(必需)、`AI_SERVICE_URL`(默认 8000)、`PORT`(3001)、`CORS_ORIGIN`(3000)；ai-service 侧 `ANTHROPIC_AUTH_TOKEN/BASE_URL/DEFAULT_MODEL`、`PROVIDER_*/MODEL_*`、`SEMANTIC_CACHE_*`、`NA_ENV_FILE`。

桌面端（`desktop/`，Electron 自包含）：bundle Node22+可重定位 Python3.12+三服务，`pnpm app:build` 出 dmg。详见 CLAUDE.md「桌面客户端」节。

---

## 8. 已知问题 / 不完整 / 待验证清单（Phase 2 输入）

> 标注来源已逐条经代码核对；🟥=可能阻断生成/功能，🟡=逻辑缺陷/半成品，⬜=待运行验证。

### 8.1 生成相关
- 🟥 **【头号架构缺陷·Phase 2 实证】批量/整书生成绕过记忆+一致性+Bible 流水线。**
  - Story Bible / 一致性 / 长程记忆 / 运行时状态（防剧透）这些「核心壁垒」全部由 `POST /chapters/:id/analyze`（L1 抽取→Entity/Event/EntityState/Information/Relation/Foreshadow + `summarizeChapter` 生成 L1/L2 摘要）填充。
  - 该 analyze 流水线**仅在单章编辑流触发**：30s 空闲自动分析 / 「完成本章」/「查问题」/「摘要」按钮。
  - `BatchChaptersModal.createAll`（`batch-chapters-modal.tsx:45-76`）只 `createChapter` + 可选 `generateChapterContent`；`generateChapterContent`（`ai.controller.ts:101-123`）**只存正文+记 AiTask，不触发 analyze/summarize**。
  - 后果：批量第 N 章 `assembleContext` 的 `prevSummary/recentSummaries/retrieved` 全空、runtime 快照全空（无抽取数据）→ 每章仅凭 {书籍元信息 + 角色卡(若有) + 本章 outline} 生成 → **章间连续性弱、防剧透/信息流引擎从不介入、一致性/伏笔/时间线/关系图对批量书全空**。这正是「创作时 bug 多、功能设计不全」的根因。
  - 即便单章流，若生成下一章时上一章 analyze 尚未跑完（异步 30s），`prevSummary` 也缺失。
- 🟡 `prompts.py:98`（outline_chapters 新书分支）JSON 示例 `{"chapters":[{"title,outline}]}` **缺引号/格式错**，可能干扰新书首批章节计划输出（existing 分支 76-80 的 `.format` 转义正确）。
- 🟡 L4 `bookSummary` 仅在「章节总数恰为 10 的倍数」时刷新（`memory.service.ts:74` `count % 10 === 0`），非按进度增量。
- 🟡 `viewpoint` 视角操作前端硬编码 `第一人称`（`chapter-editor.tsx:209`），无选择 UI；`/ai/chat` 后端不转发 history（无服务端多轮记忆）。
- ⬜ 模式 c「一次生成一本」无专用入口；批量大循环无并发/失败重试/断点续传。
- ⬜ `/ai/chapter/:id/generate`（collectStream）需实测：长章节、SSE 中断、token 累积是否完整落库。

> **Phase 2 静态核对结论**：前端 apiClient 全部路径都有对应后端路由；后端 `novelBase()`+`assembleContext()` 正确 hydrate 后转发 ai-service；`ValidationPipe{whitelist,forbidNonWhitelisted:false}` 安全（多余字段剥离不报错）；polish 用 `selection`、expand/rewrite/viewpoint 用 `text`，与 DTO 一致；SSE token 格式前后端一致。**无死按钮**。之前怀疑的 `/ai/polish|expand|...` 端点真实存在；`ChapterSummary.content` 实际存纯文本（非 JSON），无污染。问题集中在**逻辑/设计层**（见上）而非接线层。

### 8.2 一致性引擎
- 🟡 L2 规则只实装 3/9（修为倒退、已死角色行动、道具销毁/持有者健在）；`seedRules` 定义了 9 条但 `l2Rules()` 未实现规则④⑥⑦⑧⑨（一人一地、唯一道具多持、称呼一致、地理可达、时序逻辑）。
- 🟡 `consistency.service.ts` `fixIssue()` 在 **HTML 正文里直接 `includes/replace` 纯文本 evidence**，标签干扰下可能替换失败（静默不改）。
- 🟡 L3 因果链 DAG 校验偏宽松（字符串包含，非事件 ID 关联）。

### 8.3 记忆 / 时间线 / 版本
- 🟡 Memory L3 卷摘要 `refreshVolume()` 无端点、从不调用；向量检索未接（embedding 字段空）。
- 🟡 Timeline `storyTime`/`Relation.attributes` 半使用；无时间轴可视化端点。
- 🟡 `VersionService.diff()` LCS 回溯为段落级贪心，可能非最优 diff（`lineDiff()`）。

### 8.4 前端
- ⬜ `selectionOp` 的 `/ai/polish|expand|rewrite|viewpoint` 为硬编码 SSE 路径（**端点存在，非死按钮**），但无失败重试 UI。
- 🟡 `LocationPanel` 父地点要手填 entityId（无下拉/自动补全）。
- 🟡 `CostPanel` 15s 轮询无暂停；`IdeaTools` 书名按行解析对非标准格式脆弱；`visualization.tsx` 时间线主线判定靠硬编码中文关键词。
- ⬜ Server→Client 边界 `icon={X}`（组件 ref）会致 `next start` 整站 500（CLAUDE.md 坑4），需在重构 UI 时排查。

### 8.5 ai-service
- 🟡 `/config` POST 只支持 Anthropic 字段，无法切 DeepSeek/OpenAI。
- 🟡 缓存/embedding 异常吞掉无日志；缓存条数硬编码 200 不计内存；`est_tokens` 粗估致 `/stats/cost` 不准。
- 🟡 流式端点无输入长度上限、无 rate limit。

---

## 9. Phase 3 实测结果（从零生成小说·实证）

测试小说：《测试·九霄剑骨》(novelId=5)，玄幻修真，3 章约 8.4k 字。模型 glm-5.2。

**生成质量（单章）**：✅ 优秀。ch1「剑骨蒙尘」3094 字，忠实大纲、修为进度正确（淬体三层→五层）、网文语感与张力到位。GLM 表现良好。

**三模式结论**：
- **模式 a 一章一章**：✅ 生成 + analyze 流水线全通。L2 摘要结构化优秀；L1 抽取实体/状态/事件/关系/信息/伏笔；运行时快照（状态/已知·不知/信息流硬约束/上游/待埋伏笔/关系切片）**设计精良、确实工作**。L4 还**抓到真 bug**：「太医」不符修真世界观（severity high，真有价值）。
- **模式 b 批量**：⚠️ 能跑但有硬伤。① 批量计划 **重复已写情节**（第 1 条计划"万物熔炉觉醒"与 ch1 完全重复——模型锚定总纲开头，无视已写章节摘要，"绝不重复"指令失效）。② **绕过 analyze 流水线**：实测 ch18 的 `assembleContext` 中 `prevSummary=""`、近章摘要跳过 ch17 → ch3 与 ch2 **各自从头描写"大比开场"，几乎重复**。③ 整书生成无专用入口。
- **模式 c 一次生成一本**：❌ 无入口（确认）。

**L1 抽取质量缺陷（污染下游）**：
- 类型误判 + 噪声实体：把「万物熔炉（被熔炼消解）」「读者」抽成 `character`，并注入到每次生成的角色列表与运行时信息流约束（"读者"作为角色持有"已知/不知"——荒谬且有害）。
- 无去重：「万物熔炉」同时存在 item 与 character 两条。
- `information.learners` 含"读者"等元指代 → 物化成假角色。
- attrName 不一致：同一修为既记 `修为等级` 又记 `等级`，`身体` 与 `身体伤势` 并存 → **击穿 L2 修为倒退规则**（该规则按固定 attrName 匹配）。
- 实体命名脏：「粗布小包（内含一枚下品灵石）」。

**一致性引擎信噪比**：ch1 产 6 issue = 1 真有价值（太医）+ 5 噪声（L3「因果链断裂」对首章背景回溯误报，因无前置事件）。

**成本看板严重少计**：3 次章节生成 logged `tokensIn/Out=0, model=null`（流式/collectStream 不抓 usage）；analyze 流水线的 extract/check/summarize 调用走 `jsonRequest` 不经 `loggedJson`，**完全不计**。看板显示 0.0108 元，实际 ~8.4k 字章节全部漏算。

**其他**：ch2 正文混入 markdown 残留 `# 外门大比开幕`（`paragraphsToHtml` 未剥离模型输出的标题行）。

**功能可用性（GET 验证）**：bible/items、consistency changes/issues、timeline/graph、foreshadows（抽出 3 条）、stats/cost、export(txt 25KB) 均返回正确结构——接线正确，问题在数据质量（被噪声实体污染）与流水线触达。

---

## 10. 文档索引（深挖时参考）
- 后端：`apps/backend/src/{ai,consistency,bible,chapters,memory(在 ai/),...}` ；schema：`apps/backend/prisma/schema.prisma`
- ai-service：`apps/ai-service/app/{main,prompts,router,cache,embedding,config,schemas}.py`，`providers/`
- 前端：`apps/frontend/app/`、`components/{chapter-editor,workbench-panels,bible-panel,visualization,batch-chapters-modal,ui}.tsx`、`lib/api.ts`
