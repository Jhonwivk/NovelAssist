# NovelAssist · AI 辅助小说创作系统

面向网文/长篇作者的 AI 创作工作台。核心价值：**百万字级长篇的设定一致性与长程记忆**——让 AI 生成时"知道每个角色现在在哪、拿着什么、知道什么、和谁什么关系"。

差异化（vs 通用 LLM / 同类工具）：结构化 **Story Bible** + **运行时状态快照注入** + **一致性引擎五层** + **长程记忆分层**。本地单用户即可完整运行（无 Docker）。

> 产品总纲见 [`plan.md`](./plan.md)；操作指南（给 Claude Code）见 [`CLAUDE.md`](./CLAUDE.md)。

---

## 一、核心能力

| 能力 | 说明 |
|------|------|
| **沉浸编辑器** | 三栏工作台（顶栏/左章节树/中央 TipTap 宋体正文/右 4-Tab）+ 自动保存 + 字数统计 + 选中文本浮动工具栏 + 暗色默认 |
| **AI 协作** | 流式生成/续写/润色/扩写/改写/视角转换；AI 对话助手（带全书记忆）；灵感/书名/简介/钩子/大纲生成 |
| **批量生成** | AI 一次生成 N 章「标题+章纲」→ 可编辑 → 批量创建 → 可选逐章自动生成正文 |
| **运行时状态注入** ⭐ | 写章前快照出场角色"截至上章末"的状态/持有/**已知·不知信息**/关系切片，注入 Prompt |
| **一致性引擎** ⭐ | 五层：L1 事实抽取 / L2 确定性规则 / L3 图谱推理 / L4 LLM 语义 / L5 反馈学习；问题内联波浪标记 + 一键定位 |
| **长程记忆** | 分层摘要 L1 段落 / L2 章节 / L3 卷 / L4 全书 + 词法检索 + token 预算上下文组装 |
| **Story Bible** | 角色（档案+状态轨迹图表）/ 地点（层级）/ 物品（持有流转）/ 组织 / 事件（因果 DAG）/ 关系（时序）/ 伏笔（状态机）/ 信息流（谁知道什么）/ 文风 |
| **可视化** | AntV G6 关系图（章节时间滑块）+ 时间线（主线/支线/伏笔分层）+ 角色状态轨迹（情绪曲线/等级里程碑 SVG） |
| **成本控制** | 模型分级路由 + 语义缓存 + Token 成本看板（按任务/模型/缓存命中/估算费用） |
| **导入导出** | TXT / Markdown / DOCX / EPUB；导入本地大纲 |
| **结构化开局** | 新建作品预设（类型/题材/套路/核心设定/受众）+ 10 个内置套路模板（可自建）+ 建书即生成大纲 |

---

## 二、架构

三服务 monorepo，原生进程启动（**无 Docker**），SQLite 本地库。

```
┌──────────────────────────────────────────────┐
│  frontend   Next.js 14 + TipTap + Tailwind   │  http://localhost:3000
│  （三栏工作台 / 暗色 / SSE 流式消费）          │
└───────────────────┬──────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼──────────────────────────┐
│  backend    NestJS + Prisma (SQLite)          │  http://localhost:3001/api
│  CRUD + AI BFF（SSE 透传）+ 一致性引擎 +       │
│  记忆/运行时状态 + 批量生成 + 导出              │
└───────────────────┬──────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼──────────────────────────┐
│  ai-service FastAPI + uv                      │  http://localhost:8000
│  模型抽象层 + 分级路由 + Prompt + 语义缓存      │
└───────────────────┬──────────────────────────┘
                    │
             云端大模型（智谱 GLM-5.2，复用本机 Claude Code 配置）
```

**数据流（写一章）**：编辑器自动保存 → 点「生成本章」→ backend `assembleContext()` 组装上下文（分层记忆 + Bible 实体 + **运行时状态快照**）→ 透传 ai-service → GLM 流式回填 → 「分析本章」触发 L1 抽取 → 自动回写各栏 + L2/L3/L4 检查 → 内联波浪标记问题。

---

## 三、技术栈

| 层 | 选型 |
|----|------|
| 前端 | Next.js 14 (App Router) · React 18 · TipTap (ProseMirror) · TailwindCSS · TanStack Query · AntV G6 v5 |
| 后端 | NestJS · Prisma · SQLite（生产可切 Postgres+pgvector） · class-validator |
| AI 服务 | Python 3.12 · FastAPI · uv · anthropic SDK / openai SDK |
| 模型 | 智谱 GLM-5.2（Anthropic 兼容协议）；可配 DeepSeek / OpenAI / Claude |

---

## 四、快速开始

```bash
# 1. 启用 pnpm
corepack enable

# 2. 安装前端 + 后端依赖
pnpm install

# 3. 安装 AI 服务依赖（uv 按 .python-version 自动备 3.12）
cd apps/ai-service && uv sync && cd ../..

# 4. 同步大模型配置（从本机 Claude Code 一键读取）
python3 scripts/use-claude-code-config.py

# 5. 建库（SQLite，全量 Story Bible schema）
pnpm db

# 6. 启动全部服务
pnpm dev:all
```

打开 **http://localhost:3000**。

> 分终端运行：`pnpm dev`（backend + frontend）+ `pnpm ai`（ai-service）。

---

## 五、配置

### 大模型（`apps/ai-service/.env`）

**推荐：复用本机 Claude Code 配置**——`python3 scripts/use-claude-code-config.py` 自动从 `~/.claude/settings.json` 读取 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` 写入 `.env`，分级路由全部走该通道。本项目已在智谱 BigModel（`https://open.bigmodel.cn/api/anthropic`，模型 `glm-5.2`）上端到端验证。

> **注意**：Claude Code 的模型名常带上下文后缀（如 `glm-5.2[1m]`），BigModel 端点不接受方括号，脚本会自动 `split('[')[0]` 去后缀。

**或手动配置**（DeepSeek / OpenAI / Claude 任选）：

```bash
ANTHROPIC_AUTH_TOKEN=...           # 或 ANTHROPIC_API_KEY（官方）
ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic"
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...
# 分级路由 tier -> (provider, model)，provider ∈ anthropic | deepseek | openai
PROVIDER_SMALL="anthropic";   MODEL_SMALL="glm-5.2"
PROVIDER_MEDIUM="anthropic";  MODEL_MEDIUM="glm-5.2"
PROVIDER_LARGE="anthropic";   MODEL_LARGE="glm-5.2"
```

缺哪家都不影响启动，`GET :8000/health` 返回已配置 provider 列表；调用对应 provider 时若未配置返回清晰错误，前端给出提示，**CRUD/编辑器/导出照常可用**。

### 嵌入与缓存

- 账号无 embedding 余额时，`ai-service` 自动退回**本地字符 n-gram 向量**（零成本、恒可用），语义缓存与检索照常工作；有余额时自动用云端嵌入（更接近真正语义）。

### 各服务环境变量

| 文件 | 关键变量 |
|------|---------|
| `apps/backend/.env` | `DATABASE_URL="file:./dev.db"` · `AI_SERVICE_URL=http://localhost:8000` · `PORT=3001` · `CORS_ORIGIN` |
| `apps/ai-service/.env` | 见上（LLM key + 路由） |
| `apps/frontend/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:3001/api` |

---

## 六、使用流程

1. **新建作品**：首页 → 新建作品 → 选套路模板（都市重生/末世危机/…）自动填预设，或自由填类型/题材/套路/核心设定/受众 → 创建 → 自动进入「大纲」标签。
2. **大纲**：AI 生成总纲 → 优化 → 或导入本地 .md/.txt。
3. **批量建章**：工作台「✨ 批量生成章节」→ AI 出标题+章纲 → 编辑 → 全部创建（可选自动生成正文）。
4. **建设定**：「设定」标签加角色卡/世界观/地点/物品。
5. **写章节**：
   - 编辑器手打 → 字数实时统计 → 自动保存。
   - 「章节信息」勾选出场角色 → 生成时注入其运行时状态。
   - 右栏 **AI**：生成本章/续写/查问题/存版本；**状态**：看运行时快照；**问题**：分析本章（抽取+一致性）；**速查**：Bible 搜索。
   - 选中正文 → 浮动工具栏（润色/扩写/改写/视角）。
   - 正文内问题关键词自动波浪下划线，hover 看建议。
6. **检查与可视化**：工作台「一致性」（问题清单+resolve）、「关系图」（时间滑块）、「时间线」（分层）、「物品/地点」、角色卡「轨迹」情绪曲线。

---

## 七、关键子系统原理

### 一致性引擎五层（`backend/src/consistency/`）

```
L5 反馈学习  resolve（已修正/有意/忽略）→ 按假正例率调 Rule.weight
L4 LLM 语义  性格突变/动机不合理/文风跳脱，强制引用原文 + 置信度
L3 图谱推理  关系冲突（亲密与敌对并存）/ 因果链断裂（DAG 可达）
L2 规则引擎  已死角色行动 / 修为倒退 / 道具持有者已死 / 销毁道具再现（确定性、零 LLM）
L1 事实抽取  正文 → 结构化 facts 入库（state/events/entities/relations/foreshadow/
              character_states/item_transfers/information_changes）
```
入口：`POST /api/consistency/check/:chapterId`（L1→L4 全跑）、`GET /consistency/issues`、`POST /consistency/issues/:id/resolve`（L5）、`GET /consistency/changes/:chapterId`（本章变化）。

### 运行时状态注入（`backend/src/ai/runtime.service.ts`）⭐

写本章前，按 `Chapter.sceneConfig` 的出场角色，生成「截至上一章末」的快照：角色档案 + 动态状态 + **已知/不知信息** + 关系切片 + 最近事件 + 物品持有 + 因果须延续/伏笔须埋设 → 渲染成结构化块注入章节 Prompt。**信息流"谁知道什么"（`Information` 表）是防剧透/防崩的核心**。

### 长程记忆与上下文组装（`backend/src/ai/memory.service.ts`）

分层 L1-L4 + 词法检索（字符 n-gram，无向量依赖）+ token 预算组装器（plan §6.2：全书→卷纲→近章摘要→角色卡→检索记忆→运行时状态）。

### 模型路由与成本（`ai-service/app/router.py`、`cache.py`）

- 分级路由：任务 → tier（小/中/大）→ provider+model。
- **语义缓存**：非流式端点（灵感/书名/简介/钩子/摘要/抽取/审稿/文风）按输入嵌入命中复用；流式创作端点不缓存。
- 成本看板：`GET /api/stats/cost` 聚合 AiTask（调用/token/缓存命中/估算费用）。

---

## 八、数据模型（`apps/backend/prisma/schema.prisma`）

面向全量 Story Bible 抽象设计（plan §9/§21 命门①）。

- **核心**：`Novel`（含 `meta` JSON 预设、`masterOutline`、`bookSummary`）· `Volume` · `Chapter`（含 `sceneConfig`）· `Entity`（统一角色/地点/组织/道具/能力/世界观，含 `parentId` 层级、`attributes` 角色卡）· `Relation`（时序 + strength）· `Event`（含 `causes` 因果 DAG）· `EntityState`（时序状态快照）· `Information`（信息流知情者）· `Foreshadow`（状态机）· `Rule` · `StyleProfile` · `Memory`（L0-L4）· `ConsistencyIssue` · `ChapterSummary` · `ChapterSnapshot` · `AiTask` · `NovelTemplate`。

> SQLite 不支持 enum/Json：枚举用 String + 应用层校验，结构化字段用 String 存 JSON、边界 (de)serialize。切 Postgres 只改 datasource。

---

## 九、项目结构

```
novelAssit/
├── apps/
│   ├── frontend/          # Next.js：三栏编辑器、工作台（11 标签）、暗色设计系统
│   │   ├── components/    # chapter-editor / editor-marks / visualization / character-trajectory / batch-chapters-modal ...
│   │   └── lib/           # api（含 SSE）/ types / templates
│   ├── backend/           # NestJS：novels/chapters/bible/ai/memory/runtime/consistency/
│   │   └── src/           #   foreshadow/timeline/version/style/stats/templates/export/prisma
│   └── ai-service/        # FastAPI：providers/ router/ prompts/ cache/ embedding
├── scripts/use-claude-code-config.py
├── plan.md  CLAUDE.md  README.md
└── pnpm-workspace.yaml
```

---

## 十、验证状态

真实模型（智谱 GLM-5.2）端到端验证：

- ✅ 三服务启动 + 健康检查；CRUD + 自动保存 + 字数统计
- ✅ AI 流式生成/续写/润色/扩写/对话；真实流式输出
- ✅ 运行时状态注入：测试章节快照含角色状态 + 10 条信息流（不同角色各知不同事）+ 关系切片
- ✅ 一致性引擎：L1 抽取一次产出 26 状态/9 事件/6 物品/7 关系/10 信息流；L3 检出因果链断裂
- ✅ 批量生成：3 章计划（标题+章纲）；单章生成 3030 字自动落库
- ✅ 语义缓存：相同输入命中 `cached:true`
- ✅ 导出 TXT/MD/DOCX/EPUB；导入本地大纲
- ✅ 关系图时间滑块 / 时间线分层 / 角色状态轨迹图表
- ✅ 暗色 UI（默认）+ 一键浅色；`nest build` / `next build` 通过

---

## 十一、未做（plan §13 阶段五，后期基础设施）

- 用户体系 / 会员 / 支付（Stripe/微信/支付宝）/ 团队协作 / Yjs 实时协作
- 桌面端（Tauri）/ 移动端（Flutter）/ Kubernetes
- 向量库迁移（pgvector / Qdrant）；批量生成的真正异步（Celery/Redis）
- 首次使用引导、平板/手机响应式断点

本地写死单用户；这些属商业化阶段。

---

## 十二、路线图（对应 plan）

| 阶段 | 内容 | 状态 |
|------|------|------|
| 一 | 基础闭环（编辑器+AI+导出+Bible雏形） | ✅ |
| 二 | 长程记忆 + 大纲体系 + 局部操作 + 文风/审稿 | ✅ |
| 三 | 一致性引擎五层 + 伏笔/时间线 | ✅ |
| 四 | 模型路由缓存 + 成本看板 + 可视化 + 批量生成 | ✅ |
| 深化 | 运行时状态生成模块（信息流/DAG/物品/地点） | ✅ |
| UI | 暗色重设计 + 三栏编辑器 + 内联标记 + 图表 | ✅ |
| 五 | 商业化与平台化（鉴权/支付/协作/多端） | ⏳ 未做 |
