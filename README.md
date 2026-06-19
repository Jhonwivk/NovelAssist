# NovelAssist · AI 辅助小说创作系统

面向网文/长篇作者的 AI 创作工作台。核心价值：**百万字级长篇的设定一致性与长程记忆**——让 AI 在生成下一章时"知道每个角色现在在哪、拿着什么、知道什么、和谁什么关系"，并**强制走「生成 → 抽取 → 一致性 → 摘要 → 门禁」的统一流水线**，从根上解决 AI 长篇"前后矛盾、设定漂移、章节重复"的问题。

差异化（vs 通用 LLM / 同类工具）：结构化 **Story Bible** + **运行时状态快照注入** + **一致性引擎五层** + **长程记忆分层** + **章节门禁** + **整书一键编排**。本地单用户即可完整运行（无 Docker），亦有 **Electron 自包含桌面端**。

> 操作指南（给 Claude Code）见 [`CLAUDE.md`](./CLAUDE.md)；架构与重构记录见 [`architecture.md`](./architecture.md) / [`refactor-plan.md`](./refactor-plan.md)。

---

## 一、核心能力

| 能力 | 说明 |
|------|------|
| **沉浸编辑器** | 三栏（左章节树 / 中央 TipTap 宋体正文 / 右 4-Tab）+ 自动保存 + 字数统计 + 选中文本浮动工具栏（润色/扩写/改写/视角）+ 暗色默认 |
| **统一生成流水线** ⭐ | 生成正文 → 落库 → **同步** L1 抽取 + 一致性检查 + 摘要 → **门禁**（gate）。单章/批量/整书三模式都走这一条，保证章间连续 |
| **整书一键编排** ⭐ | 「整书生成」：自动总纲 → 全书章纲（带去重）→ 逐章流水线（含反向刹车），可中断/续跑、带进度 |
| **批量分析全书** ⭐ | 对已有正文逐章串行跑抽取+一致性+摘要，一键填充设定库/洞察/记忆（导入的书也能补分析） |
| **去 AI 味** | 两遍润色（去套路 → 自审残留 → 终稿），改前自动存快照可回滚 |
| **运行时状态注入** ⭐ | 写章前快照出场角色"截至上章末"的状态/持有/**已知·不知信息**/关系切片，注入 Prompt（防剧透核心） |
| **一致性引擎** | 五层：L1 事实抽取 / L2 确定性规则 / L3 图谱推理 / L4 LLM 语义 / L5 反馈学习；问题内联波浪标记 + AI 一键修复 |
| **长程记忆** | 分层摘要 L1 段落 / L2 章节 / L3 卷 / L4 全书 + 词法检索 + 语义重排 + token 预算上下文组装 |
| **Story Bible** | 统一「设定库」管理 角色/物品/地点/组织 + 世界观；角色状态轨迹；关系图/时间线/伏笔合并为「知识图谱」 |
| **分组工作台** | 左侧分组边栏：**创作**（章节/大纲/灵感）· **设定**（设定库）· **洞察**（一致性/知识图谱）· **工具**（AI助手/成本） |
| **可视化** | AntV G6 关系图（章节时间滑块）+ 时间线（主线/支线/伏笔分层）+ 角色状态轨迹（情绪曲线/等级里程碑） |
| **成本控制** | 模型分级路由 + 语义缓存 + Token 成本看板（流式生成/抽取/摘要均计入） |
| **导入导出** | TXT / Markdown / DOCX / EPUB；导入本地大纲 |
| **桌面端** | Electron 自包含 `.app`/`.exe`，bundle Node+Python+三服务，双击即用 |

---

## 二、架构

三服务 monorepo，原生进程启动（**无 Docker**），SQLite 本地库。

```
┌──────────────────────────────────────────────┐
│  frontend   Next.js 14 + TipTap + Tailwind   │  http://localhost:3000
│  （分组工作台 / 三栏编辑器 / 暗色 / SSE 流式）  │
└───────────────────┬──────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼──────────────────────────┐
│  backend    NestJS + Prisma (SQLite)          │  http://localhost:3001/api
│  CRUD + AI BFF + 统一流水线 + 一致性引擎 +     │
│  记忆/运行时状态 + 整书编排 + 导出              │
└───────────────────┬──────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼──────────────────────────┐
│  ai-service FastAPI + uv                      │  http://localhost:8000
│  模型抽象层 + 分级路由 + Prompt + 语义缓存      │
└───────────────────┬──────────────────────────┘
                    │
             云端大模型（智谱 GLM-5.2，复用本机 Claude Code 配置）
```

**数据流（写一章）**：编辑器自动保存 → 点「生成本章」→ `assembleContext()` 组装上下文（分层记忆 + Bible 实体 + **运行时状态快照**）→ 透传 ai-service → GLM 流式回填 → **生成完成后同步跑 L1 抽取 + 一致性 + 摘要 + 门禁** → 设定库/洞察/记忆即时更新，存疑章节标记「待复核」。

---

## 三、技术栈

| 层 | 选型 |
|----|------|
| 前端 | Next.js 14 (App Router) · React 18 · TipTap (ProseMirror) · TailwindCSS · TanStack Query · AntV G6 v5 |
| 后端 | NestJS · Prisma · SQLite（生产可切 Postgres+pgvector） · class-validator |
| AI 服务 | Python 3.12 · FastAPI · uv · anthropic SDK / openai SDK |
| 桌面 | Electron · python-build-standalone · electron-builder |
| 模型 | 智谱 GLM-5.2（Anthropic 兼容协议）；可配 DeepSeek / OpenAI / Claude |

---

## 四、快速开始

```bash
# 1. 启用 pnpm + 安装依赖
corepack enable
pnpm install
cd apps/ai-service && uv sync && cd ../..

# 2. 同步大模型配置（从本机 Claude Code 一键读取 GLM 配置）
python3 scripts/use-claude-code-config.py

# 3. 建库（SQLite，全量 Story Bible schema）
pnpm db

# 4. 启动全部服务（backend 3001 + ai-service 8000 + frontend 3000）
pnpm dev:all
```

打开 **http://localhost:3000**。

> 分终端：`pnpm dev`（backend + frontend）+ `pnpm ai`（ai-service）。

### 桌面端（可选）

```bash
pnpm app:build      # 自包含打包：bundle Node+Python+三服务，产出 dmg/zip
```

产出的 `.app` 双击即用，目标机无需 node/python；可写状态全部落 `app.getPath('userData')`。详见 [`CLAUDE.md`](./CLAUDE.md)「桌面客户端」节。

---

## 五、配置

### 大模型（`apps/ai-service/.env`）

**推荐：复用本机 Claude Code 配置**——`python3 scripts/use-claude-code-config.py` 自动从 `~/.claude/settings.json` 读取写入 `.env`。本项目在智谱 BigModel（`https://open.bigmodel.cn/api/anthropic`，`glm-5.2`）上端到端验证。

- 模型名带后缀（如 `glm-5.2[1m]`）会被脚本自动 `split('[')[0]` 去除（BigModel 不接受方括号）。
- 也可在主页「API 配置」面板在线改 token / base_url / model（写 `.env` 并热重载）；支持一键切换 provider。
- **注意**：`.env` 是配置的唯一真相源——`config.py` 启动时用 `load_dotenv(override=True)` 强制覆盖进程残留的环境变量，避免"改了 .env 不生效"。

**手动配置**（DeepSeek / OpenAI / Claude 任选）：

```bash
ANTHROPIC_AUTH_TOKEN=...           # 或 ANTHROPIC_API_KEY（官方）
ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic"
# 分级路由 tier -> (provider, model)，provider ∈ anthropic | deepseek | openai
PROVIDER_SMALL="anthropic";   MODEL_SMALL="glm-5.2"
PROVIDER_MEDIUM="anthropic";  MODEL_MEDIUM="glm-5.2"
PROVIDER_LARGE="anthropic";   MODEL_LARGE="glm-5.2"
```

缺哪家都不影响启动；`GET :8000/health` 返回已配置 provider，未配置时调用返回清晰错误，**CRUD/编辑器/导出照常可用**。

### 嵌入与缓存

账号无 embedding 余额时，`ai-service` 自动退回**本地字符 n-gram 向量**（零成本、恒可用），语义缓存与检索照常工作。

### 各服务环境变量

| 文件 | 关键变量 |
|------|---------|
| `apps/backend/.env` | `DATABASE_URL="file:./dev.db"` · `AI_SERVICE_URL=http://localhost:8000` · `PORT=3001` · `CORS_ORIGIN` |
| `apps/ai-service/.env` | 见上（LLM key + 路由） |
| `apps/frontend/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:3001/api` |

---

## 六、使用流程

1. **新建作品**：选套路模板自动填预设，或自由填类型/题材/套路/核心设定 → 自动进「大纲」。
2. **大纲**：AI 生成总纲 → 优化 → 或导入本地 .md/.txt。
3. **生成正文**（三选一）：
   - **整书生成**（洞察 → 一致性 / hero「生成」菜单）：一键编排全书，带进度、可中断续跑。
   - **批量生成**：AI 出多章标题+章纲 → 编辑 → 全部创建（可选自动生成正文）。
   - **单章**：编辑器右栏「生成本章」（流式回填，生成后自动分析+门禁）。
4. **建设定 / 看洞察**：
   - 「设定库」：角色/物品/地点/组织 + 世界观（多由分析自动抽取，也可手加）。
   - 「一致性 → 分析全书」：一键对全书逐章抽取，填充设定库 + 知识图谱 + 记忆。
   - 「知识图谱」：关系图 / 时间线 / 伏笔 三面切换。
5. **精修**：编辑器选中段落浮动工具栏；右栏「去AI味」两遍润色（可回滚）；问题卡可 AI 一键修复。

---

## 七、关键子系统原理

### 统一章节流水线 + 门禁（`backend/src/chapters/chapter-pipeline.service.ts`）⭐

`generateAndAnalyze()`：生成正文 → 落库 → **同步** `checkChapter`（L1-L4）+ `summarizeChapter`（L1/L2）→ 计算门禁 `gate`（L2/L3 高危冲突 + 与上一章情节重叠度）→ 据门禁置 `complete`/`needs_fix`。三模式（单章/批量/整书）共用，确保每章在下一章开写前已建好记忆。

### 一致性引擎五层（`backend/src/consistency/consistency.service.ts`）

```
L5 反馈学习  resolve（已修正/有意/忽略）→ 按假正例率调 Rule.weight
L4 LLM 语义  性格突变/动机不合理/文风跳脱（低置信自动降噪）
L3 图谱推理  关系冲突 / 因果链断裂（首章背景回溯降噪）
L2 规则引擎  已死角色行动 / 修为境界倒退 / 道具持有者已死 / 销毁道具再现
              抽取后实体去重 + 类型校验 + 过滤"读者"等元指代 + attrName 归一
L1 事实抽取  正文 → 结构化 facts 入库（state/events/entities/relations/foreshadow/
              character_states/item_transfers/information_changes）
```

入口：`POST /chapters/:id/analyze`（单章）、`POST /novels/:id/analyze-all`（全书）、`POST /consistency/issues/:id/fix`（AI 修复）。

### 运行时状态注入（`backend/src/ai/runtime.service.ts`）⭐

写本章前，按 `Chapter.sceneConfig` 出场角色，生成「截至上一章末」快照：角色档案 + 动态状态 + **已知/不知信息** + 关系切片 + 最近事件 + 物品持有 + 因果须延续/伏笔须埋设 → 注入章节 Prompt。**信息流"谁知道什么"是防剧透/防崩的核心**。

### 长程记忆与上下文组装（`backend/src/ai/memory.service.ts`）

分层 L1-L4 + 词法检索（字符 n-gram）+ 字符 n-gram 余弦**语义重排** + token 预算组装器。

### 模型路由与成本（`ai-service/app/router.py`、`cache.py`）

- 分级路由：任务 → tier → provider+model。
- **语义缓存**：非流式端点按输入嵌入命中复用；流式创作端点不缓存。
- 流式端点流末发 `usage` 事件，后端计入 AiTask → 成本看板准确（`GET /api/stats/cost`）。

---

## 八、数据模型（`apps/backend/prisma/schema.prisma`）

面向全量 Story Bible 抽象：`Novel`（含 `meta` JSON 预设、`masterOutline`、`bookSummary`）· `Volume` · `Chapter`（含 `sceneConfig`、`status: complete|writing|needs_fix|gen_failed`）· `Entity`（统一角色/地点/组织/道具/能力/世界观，`parentId` 层级、`attributes` 角色卡）· `Relation`（时序 + strength）· `Event`（`causes` 因果 DAG）· `EntityState` · `Information`（信息流知情者）· `Foreshadow` · `Rule` · `StyleProfile` · `Memory`（L0-L4）· `ConsistencyIssue` · `ChapterSummary` · `ChapterSnapshot` · `AiTask` · `NovelTemplate`。

> SQLite 不支持 enum/Json：枚举用 String + 应用层校验，结构化字段用 String 存 JSON。

---

## 九、项目结构

```
novelAssit/
├── apps/
│   ├── frontend/          # Next.js：分组工作台（4 组）、三栏编辑器、暗色设计系统
│   │   ├── components/    # chapter-editor / workbench-nav / entity-browser /
│   │   │                  # knowledge-view / issue-card / autopilot-modal / visualization ...
│   │   └── lib/           # api（含 SSE）/ types / use-html-theme / templates
│   ├── backend/           # NestJS：novels/chapters/chapter-pipeline/bible/ai/memory/
│   │   └── src/           #   runtime/consistency/foreshadow/timeline/version/style/stats/export
│   └── ai-service/        # FastAPI：providers/ router/ prompts/ cache/ embedding
├── desktop/               # Electron 自包含打包（main.cjs / build.cjs / builder.yml）
├── scripts/use-claude-code-config.py
└── architecture.md  refactor-plan.md  CLAUDE.md  README.md
```

---

## 十、验证状态

真实模型（智谱 GLM-5.2）端到端验证：

- ✅ **14 万字《窃天诀》整书生成**：30 章，autopilot 全自动，跨章连续（ch2 直接续 ch1 悬念、零重写），自评 88 分；抽取干净（无"读者"等噪声实体）
- ✅ 统一流水线：批量/整书生成不再绕过记忆+一致性；重生成的章节 overlap 降至 0.148（旧版会重写上一章）
- ✅ 门禁：正确标记存疑章节 `needs_fix`，L4 低置信降噪
- ✅ 运行时状态注入 + 信息流（防剧透）+ 关系切片
- ✅ 一致性引擎五层 + AI 一键修复（段落级替换）+ 去AI味两遍润色
- ✅ 批量分析全书 / 关系图时间滑块 / 时间线 / 角色轨迹
- ✅ 暗色 UI（默认）+ 分组边栏 + 一键浅色；`nest build` / `next build` 通过

> GLM 账号有 `$10/5h` 消费上限，超大批量生成可能撞顶返 402（等窗口刷新即可，非代码问题）。

---

## 十一、路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| 一~四 | 基础闭环 / 长程记忆 / 一致性引擎五层 / 模型路由缓存 / 可视化 / 批量生成 | ✅ |
| 深化 | 运行时状态生成 + 统一流水线 + 门禁 + 整书编排 + 去AI味 | ✅ |
| UI | 分组边栏工作台 + 设定库/知识图谱合并 + 编辑器可操作化 + 首页美化 | ✅ |
| 桌面 | Electron 自包含打包 | ✅ |
| 五 | 商业化（鉴权 / 支付 / 协作 / 多端） | ⏳ 暂未做（本地写死单用户） |
