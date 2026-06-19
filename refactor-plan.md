# NovelAssist 重构方案（确保"能稳定生成好小说"）

> 依据：Phase 2 静态核对 + Phase 3 实测（《测试·九霄剑骨》3 章）+ LLM 评判（系统自带 `/review` 给 78 分但漏判跨章重复）+ 参考 [leenbj/novel-creator-skill](https://github.com/leenbj/novel-creator-skill)。
> 详细证据见 `architecture.md` §8/§9。本文件是 Phase 4 产出，并作为 Phase 5（UI 重构）的功能蓝本。

## 〇、实施状态（2026-06-17）

**P0 已实现并验证 ✅**（提交未做，等你审阅）。改动文件：
- 后端：`common/text.utils.ts`（+`bigramSimilarity`/`bigramContainment`）、新增 `chapters/chapter-pipeline.service.ts`（`ChapterPipelineService`：generate→落库→**同步**checkChapter+summarize→gate）、`chapters/chapters.module.ts`、`chapters/chapters.controller.ts`（+`POST /chapters/:id/write`、`GET /chapters/:id/gate`）、`ai/ai.controller.ts`（outlineChapters 去重过滤）。
- 前端：`lib/api.ts`（`generateChapterContent` 改指 `/chapters/:id/write` 返回 gate；`ChapterGate` 类型）、`batch-chapters-modal.tsx`（显示门禁标记数 + 去重提示）。
- backend `nest build`、frontend `tsc --noEmit` 均通过。

**实测验证**（dev 后端 :3002 + 真实 GLM，对《九霄剑骨》novel#5）：
- ch18 经新流水线重生成后 `overlapPrev=0.148`，正文从"七号擂台·第一场对钱通"直接续写，**不再重开大比开场**（旧版会重描晨雾/报名/嘲笑）——头号连续性 bug 已修复。
- gate 正确拦截：ch18 `passed:false` 抓到"淬体二层 vs 五层"修为不一致，置 `status:needs_fix`。
- 重跑批量计划：5 章全为前进剧情（淘汰赛→八强→半决赛对赵狂澜），**不再重复 ch1 觉醒**。

> **⚠️ 部署须知**：你当前运行在 :3000/3001/8000 的是**已打包的 Electron 桌面 app**（`desktop/dist/.../node dist/main.js`，数据库在 `~/Library/Application Support/novel-assist/db/novelassist.db`），**不是仓库 dev server**。所以上述源码改动**尚未在你的桌面 app 生效**。要用上修复：① 开发态 `pnpm dev:all`（仓库源码，dev.db）；或 ② 重新打包 `pnpm app:build` 出新桌面 app。本次验证用的是 DB 副本（`/tmp/na_verify.db`），**未改动你的桌面 app 数据**。

**P1 + 整书编排 已实现并验证 ✅**：
- 抽取硬化（`consistency.service.ts`）：实体名规范化去括注/去重、过滤"读者/作者"等元指代、`attrName` 归一（修为/等级/境界→境界，修复 L2 修为规则）、`EntityState` 去重 upsert、L3 首章因果降噪。
- `text.utils.paragraphsToHtml`：剥离模型输出的 markdown 残留（`#`标题/```围栏/整行加粗）。
- 整书编排（`chapter-pipeline.service.ts autopilotBook` + `POST /novels/:id/autopilot`）：**一次性规划全书**（避免分波 re-plan 重复开头）→ 逐章 `generateAndAnalyze`（带 targetWords + 反向刹车 instruction）→ 失败标记可续跑。
- gate 调优：仅 L2/L3 高危硬拦截，L4 语义高危降级为提示（不阻断生成）。

**🎯 10万字实测（《窃天诀》novel#5，dev 后端 :3010 + 真实 GLM）**：
- **30 章 ≈ 14.2 万字，0 失败**，3 章被门禁标记 needs_fix（真实 L2/L3 冲突，符合预期）。
- 上游一次性规划 30 章标题连贯无重复（废灵根弃子→枯井→大比→夺回灵根→太虚来人→飞舟→新猎场）。
- **连续性彻底修复**：ch2 开篇"洞口外的脚步声骤然停住"直接续 ch1 结尾"他看到了不该看的东西"，零重新介绍。
- **抽取干净**：实体无"读者/（被熔炼消解）"噪声；`境界` attrName 统一。
- **跨章伏笔成立**：叶长风/血煞教/寄魂蛊/三年前灵根被夺，ch1-2 埋设，ch16/ch30 回收（评判佐证）。
- **LLM 自评判**（系统 `/review`）：ch1/ch16/ch30 **均 88 分**，评语称"推背感强、爽点密集、情绪张力拉满、设定融合自然"；缺点为偶发错别字（膻中穴误作檀中穴）、中段设定说明书式倾倒、升级偏快。
- 导出 txt 425KB 正常。

**已知遗留（非阻断，记入待办）**：
- 整书 autopilot 直接 `chapter.update` 未走 `recountNovel` → Novel.wordCount 显示 0（每章 wordCount 正确）。修：autopilot 末尾调一次 recount。
- gate 的 L4 误报仍偏多（升级快被判"修为矛盾"），后续可加白名单/置信阈值。
- 偶发错别字与"设定倾倒"属生成质量，P1 质量项（Beat 分解 / 去AI味两遍润色）可进一步改善。

**下一步**：P2（成本看板修准/检索升级/多 provider）→ **Phase 5 UI 重构**（围绕章节流水线 + gate 面板 + 整书 autopilot 编排重做信息架构）。

### 第二轮（A-D，已全部完成）

**A 收尾 bug**：A1 流水线写章后回算 `Novel.wordCount`（修列表字数显示 0）；A2 `htmlToParagraphs` 保留 `</p>/<br>` 段落边界（修导出/导入全章并一段）；A3 L4 语义层丢弃 confidence<0.55（降噪）。
**B 质量**：B4 ai-service `/humanize` 两遍去AI味（去套路→自审残留→终稿）+ 后端 `/ai/humanize/:chapterId`（改前存 pre-humanize 快照）；B5 `/chapter-beats` 章纲→4-6 拍；B6 `fixIssue` 改段落级 `<p>` 替换（不再被 HTML 标签干扰静默失败）。另：曾加"境界越级"L2 规则，因阶梯写死只对修真有效，**按用户要求已删除**（境界类交 L4 语义层）。
**C 工程**：C7 流式端点流末发 `usage` 事件 + `collectStream` 捕获并记 AiTask（修成本看板把章节生成记 0）；memory/consistency 内部 LLM 调用改 `loggedJsonSilent`（原来完全不计）；C8 检索加字符 n-gram 余弦重排（词法召回+语义重排）；`/config` 支持 DeepSeek/OpenAI/一键 provider 切换；`POST /memory/volume/:novelId` 暴露 L3 卷摘要。
**D UI**：新增 `AutopilotModal`（整书一键生成：目标章数/每章字数、3s 轮询进度、可停止、可续跑、完成摘要含 gateFailed/failed）；工作台 hero 加「整书生成」按钮；章节树 Badge 支持 `needs_fix`（待复核·黄）/`gen_failed` 状态；编辑器 AI 面板加「去AI味润色」按钮。

**全部 build/typecheck 通过**（backend nest build / frontend tsc --noEmit / ai-service import）。`curl` 验证：工作台页 200、`/chapters/:id/gate` 正常、导出分段正常。

**⚠️ 重要**：本轮实跑验证因 **GLM 账号 $10/5h 额度耗尽**（生成《窃天诀》用满）无法执行——所有 402/500 均为额度而非代码问题，等额度恢复即可实跑。代码层已验证（编译/类型/路由/GET 端点）。

---

## 一、核心诊断（一句话）

**系统拥有正确的数据结构（Story Bible / 一致性 / 长程记忆 / 运行时状态），但把它们当作"事后、异步、可选的分析"，而不是"生成循环里强制、阻塞的环节"。** 于是最常用的批量/整书生成路径完全绕过这些壁垒，单章路径也依赖 30s 异步分析"碰运气"。结果：单章质量高，但**跨章连续性崩、抽取噪声污染、爽点节奏失控**。

参考 skill 的关键差异：它把同样的能力做成**每章必过的"五步门禁"**（更新记忆→检查一致性→风格校准→校稿→门禁检查），`gate_result.json` 不 `passed:true` 则下一章不解锁。这就是要补的"骨架"。

## 二、问题 → 机制 对照（skill 怎么解，我们缺什么）

| 实测问题（证据） | 参考 skill 的机制 | NovelAssist 现状 |
|---|---|---|
| **批量/整书绕过流水线**（ch18 `prevSummary=""`，ch3 重复 ch2 开场） | **每章强制五步门禁**，不过不解锁下一章 | analyze 为 fire-and-forget，批量根本不调 |
| **批量计划重复已写情节**（"万物熔炉觉醒"重复 ch1） | **大纲锚点 + 进度配额** + **事件矩阵冷却**（conflict_thrill 冷却 2 章等） | 仅靠 prompt"绝不重复"，无结构约束 |
| 整章一次成文、易跑偏 | **Beat Sheet → Beat 扩写 → 章节合成** 三段 | 30-80 字章纲一把梭生成 |
| 抽取噪声（"读者""万物熔炉(被熔炼消解)"成 character，无去重，attrName 不一） | 知识图谱 typed 节点 + 级联回写 | L1 抽取直接入库，无校验/去重/规范化 |
| 文字有 AI 味（评判提示"脸谱化/升级廉价"） | **去AI味两遍润色** + 7 类 AI 套路检测 | 无 |
| 爽点过快、过早收冲突 | **反向刹车**：每章必须新增未决问题 + 悬念钩子 | 无节奏控制 |
| 词法检索弱 | 两级 RAG（TF-IDF 粗筛→语义重排 TopK） | 仅字符 n-gram 词法 |
| 成本看板少计（章节生成 token=0） | —（与生成正交） | 流式不抓 usage、内部调用不记 |

## 三、重构方案（按优先级）

### P0 — 让生成"真正用上壁垒"（不修这个，其余都是空中楼阁）

1. **统一"生成即入库即分析"的章节流水线**。废弃"批量只存正文、analyze 另说"的分裂。新增 `ChapterPipelineService.writeChapter(chapterId)`：
   `assembleContext → 生成 → 落库 → **同步**跑 analyze（L1 抽取+摘要+一致性）→ 产出本章 gate 结果`。
   单章「生成本章」、批量、整书三入口**都走这一条**，区别只是串行/并行/批量调度。直接复用现有 `memory.summarizeChapter`、`consistency.checkChapter`、`runtime.snapshot`，只是把它们从"可选"变"管线内必经"。
2. **章节门禁（gate）**。analyze 后计算 `gate`：高危一致性问题数、是否缺前情衔接、与最近 N 章的情节重叠度（用现有词法检索算相似度阈值）。`gate.passed=false` 时：批量/整书**暂停并标红该章**等人工处理或自动 `/fix`；不静默继续。落 `Chapter.status`（新增 `needs_fix`）+ 一个 `gate` JSON 字段。
3. **批量去重硬约束**。`outlineChapters` 已传 existingChapters，但模型无视。改为：① prompt 里把"已写情节要点"列成**禁止清单**并要求每条新计划声明"推进了什么新进展"；② 服务端对返回计划与已有章纲做词法相似度过滤，超阈值的自动剔除/重生成。根治"ch1 被重复规划"。
4. **修复批量生成的上下文饥饿**：因 P0.1 后批量每章都会生成摘要，`prevSummary/recentSummaries` 自然补齐，ch3 不再重写 ch2 开场。

### P1 — 抽取与一致性提质（壁垒的数据要干净）

5. **L1 抽取后处理硬化**（`consistency.extractAndStore`）：
   - **实体去重**：入库前按 name 规范化（去括号注释"（被熔炼消解）"、去"（内含…）"）+ 别名归并，已存在则 merge 不新建。
   - **类型校验**：character 必须是叙事人物；过滤 `读者/作者/旁白` 等元指代；`information.learners` 同样过滤非角色。
   - **attrName 归一**：把 `修为等级/等级/境界` 映射到统一键 `境界`，`身体/身体伤势`→`身体`。统一后 **L2 修为倒退规则才生效**。
6. **L2 规则补全**：把 seedRules 已定义但未实装的 6 条（一人一地、唯一道具多持、称呼一致、地理可达、时序逻辑）实装；并修 `fixIssue` 的 HTML 直替（改为段落级定位替换，避免标签干扰静默失败）。
7. **L3 因果误报抑制**：首章/背景回溯类 `causes` 不应报"因果链断裂"——只对"声称引用本书已发生事件却找不到"才报，降噪。

### P1 — 生成质量（让"好看"可控）

8. **Beat 分解（轻量版）**：写章前先由 `/chapter-beats` 把章纲拆成 4-6 个 beat（含目标/冲突/钩子），再逐 beat 扩写合成。可作为"高质量模式"开关，避免一把梭跑偏。
9. **去AI味后处理**：新增 `/humanize` 端点（两遍：去套路→自审残留），在 gate 的"风格校准"步调用。参考 skill 的 7 类套路与"最小改动"。
10. **反向刹车**：章节 prompt 增加硬约束"本章须新增一个未决冲突并以悬念收尾"，并在 gate 校验是否满足。
11. **markdown 残留清理**：`paragraphsToHtml` 前剥离模型输出的 `#` 标题行/```代码围栏（ch2 出现 `# 外门大比开幕` 泄漏）。

### P2 — 工程与可观测

12. **成本看板修准**：流式/`collectStream` 解析 usage（让 ai-service 在 `[DONE]` 前发一个 usage 事件）；`memory/consistency` 的内部 LLM 调用统一走 `loggedJson`。否则成本完全失真。
13. **检索升级**：词法 + 语义重排（embedding 已有本地降级，可复用做 re-rank）。
14. `/config` 支持多 provider 切换；缓存按内存上限而非硬编码 200 条。

## 四、"一次生成一本"应该怎么做（模式 c 补全）

不是加一个"一键全书"黑盒，而是**编排 P0 的章节流水线**：
`生成总纲 → 批量章纲（带去重）→ 逐章 writeChapter（gate 串行/小并发）→ 失败章自动 /fix 或暂停待人工 → 每 10 章 refreshBook 压缩记忆`。
前端给一个**带进度 + gate 状态 + 可中断/续跑**的面板（替代现批量弹窗的"傻循环"）。这正好接 Phase 5。

## 五、验证标准（让 LLM 评判确认"功能 OK"）

重构后重跑《九霄剑骨》≥10 章并断言：
- 无相邻章情节重复（词法相似度 < 阈值）；批量章 `prevSummary` 非空。
- Bible 无 `读者`/重复实体；`境界` attrName 统一，L2 修为倒退规则能命中人为制造的倒退。
- 整书流水线可中断/续跑，失败章被 gate 拦下。
- `/review` 跨章评分均分 ≥ 当前；新增一个**跨章一致性评判**（喂相邻两章给 LLM 判重复/矛盾）作为回归。
- 成本看板 token 数与实际 GLM 用量同量级（不再为 0）。

## 六、落地顺序建议

P0（1-4）→ P1 抽取(5-7) → P1 质量(8-11) → P2(12-14)。P0 完成即可让三种模式都"真正生成连贯小说"；P1/P2 提质。Phase 5 UI 围绕"章节流水线 + gate 面板 + 整书编排"重构信息架构。
