"""Prompt 构造器。集中维护，便于阶段四做 Prompt 自动迭代与缓存。"""

from __future__ import annotations

from typing import Optional

from .schemas import (
    ChapterRequest,
    ContinueRequest,
    OutlineOptimizeRequest,
    OutlineChaptersRequest,
    OutlineRequest,
    PolishRequest,
    SummarizeRequest,
)

WRITER_SYSTEM = (
    "你是一位资深网络小说作者，擅长长篇连载。"
    "写作要求：文笔流畅、节奏紧凑、人物鲜活、符合网文阅读习惯；"
    "严格遵循给定的世界观与设定，不臆造与设定冲突的内容；"
    "直接输出小说正文，不要解释、不要复述要求、不要使用 Markdown 标题。"
)


def _world_block(req) -> str:
    parts = []
    if getattr(req, "genre", None):
        parts.append(f"类型：{req.genre}")
    if getattr(req, "theme", None):
        parts.append(f"题材：{req.theme}")
    if getattr(req, "trope", None):
        parts.append(f"叙事套路：{req.trope}")
    if getattr(req, "coreSetting", None):
        parts.append(f"核心设定：{req.coreSetting}")
    if getattr(req, "audience", None):
        parts.append(f"受众：{req.audience}")
    if getattr(req, "synopsis", None):
        parts.append(f"简介：{req.synopsis}")
    if getattr(req, "worldviewText", None):
        parts.append(f"世界观/设定：\n{req.worldviewText}")
    return "\n".join(parts)


def outline(req: OutlineRequest) -> tuple[str, list[dict]]:
    system = (
        "你是一位资深网文策划，擅长设计有卖点、有钩子的大纲。"
        "输出结构化、可直接执行的大纲（总纲/卷纲/章纲可按需展开），使用清晰的中文。"
    )
    user = f"请为作品《{req.title or '未命名'}》设计大纲。\n\n{_world_block(req)}"
    if req.instruction:
        user += f"\n\n额外要求：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def outline_optimize(req: OutlineOptimizeRequest) -> tuple[str, list[dict]]:
    system = (
        "你是一位资深网文策划。请在现有大纲基础上**优化**：补全卷目与节奏，强化钩子与爽点/冲突，"
        "修正结构问题，保持原意与设定一致。直接输出优化后的完整大纲，使用清晰的中文，不要解释。"
    )
    user = f"作品《{req.title or '未命名'}》\n"
    if _world_block(req):
        user += f"{_world_block(req)}\n\n"
    user += f"现有大纲：\n{truncate(req.currentOutline, 6000)}"
    if req.instruction:
        user += f"\n\n本次优化重点：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def outline_chapters(req: OutlineChaptersRequest) -> tuple[str, list[dict]]:
    existing = list(getattr(req, "existingChapters", []) or [])
    if existing:
        # 已有章节 → 严格接着往后规划，绝不重复已写节点
        start = len(existing) + 1
        end = start + req.count - 1
        system = (
            "你是资深网文策划。作品已写到第 {n} 章，请**严格接着现有进度往后**规划第 {s}~{e} 章，"
            "推进剧情、**绝不重复已写过的情节节点**。**只输出 JSON**："
            '{{"chapters":[{{"title","outline"}}]}}，title 为简短章节名（不带「第N章」前缀），'
            "outline 为该章要点/情节/钩子（30-80 字）。按时间顺序、节奏紧凑、有钩子。不要解释。"
        ).format(n=len(existing), s=start, e=end)
        user = f"作品《{req.title or '未命名'}》\n"
        if _world_block(req):
            user += f"{_world_block(req)}\n\n"
        if getattr(req, "bookSummary", None):
            user += f"【全书摘要】\n{truncate(req.bookSummary, 1500)}\n\n"
        recent = existing[-12:]
        user += "【已写章节（严禁重复这些情节）】\n" + "\n".join(
            f"第{c.order + 1}章 {c.title}：{truncate(c.summary, 120) or '（无摘要）'}" for c in recent
        ) + "\n\n"
        user += f"【总纲（参考整体走向，从当前位置往后推进）】\n{truncate(req.masterOutline or '（无）', 3000)}\n\n"
        user += f"请规划接着往后的 {req.count} 章。"
        if req.instruction:
            user += f"\n\n额外要求：{req.instruction}"
        return system, [{"role": "user", "content": user}]
    # 无已有章节：从总纲开头拆（原逻辑）
    system = (
        "你是资深网文策划。把作品总纲拆解为连续的章节计划。**只输出 JSON**："
        '{"chapters":[{"title,outline}]}，'
        "title 为简短章节名（不带「第N章」前缀），outline 为该章要点/情节/钩子（30-80 字）。"
        f"共 {req.count} 章，按时间顺序，节奏紧凑、有钩子。不要解释。"
    )
    user = f"作品《{req.title or '未命名'}》\n"
    if _world_block(req):
        user += f"{_world_block(req)}\n\n"
    user += f"总纲：\n{truncate(req.masterOutline or '（无，请据设定自由规划）', 6000)}"
    if req.instruction:
        user += f"\n\n额外要求：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def chapter(req: ChapterRequest) -> tuple[str, list[dict]]:
    target = f"约 {req.targetWords} 字" if req.targetWords else "1500-2500 字"
    user = f"请撰写作品《{req.title or '未命名'}》的新一章正文（{target}）。"
    if _world_block(req):
        user += f"\n\n{_world_block(req)}"
    if req.previousSummary:
        user += f"\n\n上一章内容摘要：\n{req.previousSummary}"
    if getattr(req, "context", None):
        user += f"\n\n相关前情 / 设定 / 记忆：\n{truncate(req.context, 4000)}"
    user += f"\n\n本章标题：{req.chapterTitle or '（待定）'}"
    if req.outline:
        user += f"\n本章大纲/要点：\n{req.outline}"
    if req.instruction:
        user += f"\n\n特别要求：{req.instruction}"
    user += "\n\n请直接开始正文。"
    return WRITER_SYSTEM, [{"role": "user", "content": user}]


def continue_writing(req: ContinueRequest) -> tuple[str, list[dict]]:
    user = "请根据已有正文自然续写，保持文风、人称、设定一致，直接输出续写内容。"
    if _world_block(req):
        user += f"\n\n{_world_block(req)}"
    if getattr(req, "context", None):
        user += f"\n\n相关前情 / 记忆：\n{truncate(req.context, 3000)}"
    user += f"\n\n已有正文（接续其后）：\n{truncate(req.content, 4000)}"
    if req.instruction:
        user += f"\n\n特别要求：{req.instruction}"
    return WRITER_SYSTEM, [{"role": "user", "content": user}]


def polish(req: PolishRequest) -> tuple[str, list[dict]]:
    user = (
        "请润色/改写下面这段文字，提升文采与节奏，保留原意与人物语气，"
        "直接输出润色后的正文（不要解释、不要加引号或前后缀）。"
    )
    if req.worldviewText or req.genre:
        user += f"\n\n参考设定：{_world_block(req)}"
    if req.context:
        user += f"\n\n上下文：{truncate(req.context, 1500)}"
    user += f"\n\n待润色片段：\n{truncate(req.selection, 3000)}"
    if req.instruction:
        user += f"\n\n特别要求：{req.instruction}"
    return WRITER_SYSTEM, [{"role": "user", "content": user}]


def summarize(req: SummarizeRequest) -> tuple[str, list[dict]]:
    system = (
        "你是一位严谨的小说编辑助理。请把章节正文压缩为结构化的 L2 章节摘要，"
        "用中文输出，包含：主要事件、出场人物、关键状态变化。简明扼要，"
        "面向后续章节写作时作为前情提要使用。"
    )
    user = f"章节标题：{req.title or '（未命名）'}\n\n章节正文：\n{truncate(req.content, 6000)}"
    return system, [{"role": "user", "content": user}]


def chat(req) -> tuple[str, list[dict]]:
    system = "你是一位贴心的小说创作助手，可以结合给定的作品设定回答作者的问题、给建议、头脑风暴。"
    user = ""
    if _world_block(req):
        user += f"作品设定：\n{_world_block(req)}\n\n"
    if getattr(req, "context", None):
        user += f"相关前情 / 记忆：\n{truncate(req.context, 3000)}\n\n"
    user += f"作者的问题：{req.message}"
    messages = list(req.history or [])
    messages.append({"role": "user", "content": user})
    return system, messages


# ==================== 阶段二：大纲 / 灵感 / 局部操作 ====================

def idea(req) -> tuple[str, list[dict]]:
    system = "你是资深网文策划，擅长产出有卖点、有差异化的点子。给出 5 个差异化的小说灵感，每个含：书名、一句话卖点、核心冲突。简洁，用中文。"
    parts = []
    if req.genre:
        parts.append(f"题材方向：{req.genre}")
    if req.keywords:
        parts.append(f"关键词：{req.keywords}")
    user = "\n".join(parts) or "请随机产出灵感。"
    if req.instruction:
        user += f"\n额外要求：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def titles(req) -> tuple[str, list[dict]]:
    system = f"你是网文书名专家。请给出 {req.count} 个有吸引力、符合题材的中文书名候选，每行一个，不要编号不要解释。"
    user = _world_block(req) or "请给出书名候选。"
    if req.instruction:
        user += f"\n要求：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def synopsis(req) -> tuple[str, list[dict]]:
    system = "你是网文简介写手。请写一段 150-300 字的简介，有钩子、有卖点、留悬念。只输出简介正文。"
    user = _world_block(req) or "请写简介。"
    if req.instruction:
        user += f"\n要求：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def hook(req) -> tuple[str, list[dict]]:
    system = "你是钩子设计专家。给出 3 个强力开篇钩子（首章抓人段落，各 100 字左右），用中文，编号列出。"
    user = _world_block(req) or "请设计开篇钩子。"
    if req.instruction:
        user += f"\n要求：{req.instruction}"
    return system, [{"role": "user", "content": user}]


def book_summary(req) -> tuple[str, list[dict]]:
    system = (
        "你是小说编辑。请把给定的卷/章摘要汇总为一份 <2000 字的全书摘要（L4），"
        "覆盖主线推进、关键转折、当前进展，面向后续写作时作为全书记忆。只输出摘要正文。"
    )
    user = f"作品《{req.title or '未命名'}》\n"
    if req.synopsis:
        user += f"简介：{req.synopsis}\n"
    if req.volumeSummaries:
        user += "各卷摘要：\n" + "\n---\n".join(req.volumeSummaries[:20]) + "\n"
    if req.chapterSummaries:
        user += "近期章节摘要：\n" + "\n".join(req.chapterSummaries[-20:]) + "\n"
    return system, [{"role": "user", "content": user}]


def local_edit(req, mode: str) -> tuple[str, list[dict]]:
    """mode: expand | rewrite | viewpoint | style"""
    instruct = {
        "expand": "请把下面这段扩写得更丰富（补充细节、动作、心理、环境），保留原意与人物语气，直接输出扩写后的正文",
        "rewrite": "请改写下面这段，提升文采与节奏，保留原意与人物语气，直接输出改写后的正文",
        "viewpoint": f"请把下面这段转换为「{req.viewpoint or '第一人称'}」视角重写，保留情节，直接输出正文",
        "style": f"请把下面这段改写为「{req.style or '更紧凑、更有画面感'}」的风格，保留原意，直接输出正文",
    }[mode]
    user = instruct + "。不要解释、不要加引号或前后缀。"
    if _world_block(req):
        user += f"\n\n参考设定：{_world_block(req)}"
    user += f"\n\n原文：\n{truncate(req.text, 3000)}"
    if req.instruction:
        user += f"\n\n特别要求：{req.instruction}"
    return WRITER_SYSTEM, [{"role": "user", "content": user}]


# ==================== 阶段三：一致性引擎（L1 抽取 / L4 语义）====================

_EXTRACT_SYSTEM = (
    "你是严谨的小说设定抽取器。从章节正文中抽取结构化事实，**只输出 JSON**，不要解释。"
    "字段：state_changes[{entity,attr,value,evidence}]、"
    "events[{type,participants[],location,result,causes[]}]（causes 为本事件依赖的前置事件描述，无则空）、"
    "new_entities[{type,name,description}]、relation_changes[{subject,object,type,strength}]（strength 为 -10~10 整数，亲密为正、敌对为负，可省略）、"
    "foreshadow_triggers[{title,action}]（action ∈ setup|payoff）、"
    "character_states[{entity,位置,情绪,身体,等级}]（本章结束时该角色的当前状态，只填出现的字段）、"
    "item_transfers[{item,from,to}]（道具易主；from/to 为角色名，可为空）、"
    "information_changes[{content,learner,action}]（action ∈ learn|forget；谁获知/遗忘了一条信息）。"
    "evidence 必须是正文原句片段。没有的字段给空数组。"
)


def extract(req) -> tuple[str, list[dict]]:
    title = req.title or "（未命名）"
    known = ", ".join(req.knownEntities) or "（无）"
    body = truncate(req.content, 6000)
    user = f"章节标题：{title}\n已知实体：{known}\n\n正文：\n{body}"
    return _EXTRACT_SYSTEM, [{"role": "user", "content": user}]


_CHECK_SYSTEM = (
    "你是资深小说责编，专注发现**软矛盾**（性格突变、动机不合理、文风跳脱、情感断裂、对话不符合人设）。"
    "只检查新章节相对设定/前文的问题，**不要**报告风格偏好或主观建议。**只输出 JSON**："
    "{\"issues\":[{\"type,severity(high|medium|low),evidence_quote(新章节原句),explanation,"
    "suggestion,confidence(0-1)}]}。没有问题就返回 {\"issues\":[]}。"
)


def consistency_check(req) -> tuple[str, list[dict]]:
    import json as _json

    user = ""
    if _world_block(req):
        user += f"作品设定：{_world_block(req)}\n\n"
    if req.priorContext:
        user += f"前文事实 / 摘要：\n{truncate(req.priorContext, 2500)}\n\n"
    if req.characters:
        chars = _json.dumps(req.characters, ensure_ascii=False)[:1500]
        user += f"主要角色：{chars}\n\n"
    if req.rules:
        rules_block = "\n".join(f"- {r}" for r in req.rules[:20])
        user += f"硬规则：\n{rules_block}\n\n"
    title = req.chapterTitle or ""
    body = truncate(req.content, 5000)
    user += f"待检查章节《{title}》：\n{body}"
    return _CHECK_SYSTEM, [{"role": "user", "content": user}]


# ==================== 阶段四：审稿 / 文风守卫 ====================

_REVIEW_SYSTEM = (
    "你是网文审稿编辑。对正文给出质量分析，**只输出 JSON**："
    "{\"score(0-100),typos[字符串],rhythm(一句评价),hooks[段落引用],"
    "emotion_curve(一句评价),dialogue_ratio(0-1),info_density(一句评价),suggestions[字符串]}。"
)


def review(req) -> tuple[str, list[dict]]:
    user = f"正文：\n{truncate(req.content, 6000)}"
    if req.instruction:
        user += f"\n\n关注点：{req.instruction}"
    return _REVIEW_SYSTEM, [{"role": "user", "content": user}]


_STYLE_GUARD_SYSTEM = (
    "你是文风守卫。判断正文是否符合给定文风特征与样本、是否命中禁用词。**只输出 JSON**："
    "{\"consistent(bool),banned_hits[命中的禁用词],drifts[文风偏离点],score(0-100),suggestions[字符串]}。"
)


def style_guard(req) -> tuple[str, list[dict]]:
    user = ""
    if req.traits:
        user += f"文风特征：{req.traits}\n"
    if req.bannedWords:
        user += f"禁用词：{', '.join(req.bannedWords)}\n"
    if req.samples:
        user += "参考样本：\n" + "\n---\n".join(req.samples[:3]) + "\n"
    user += f"\n待检查正文：\n{truncate(req.text, 5000)}"
    return _STYLE_GUARD_SYSTEM, [{"role": "user", "content": user}]


def truncate(text: Optional[str], limit: int) -> str:
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "……（截断）"


def fix_issue(req) -> tuple[str, list[dict]]:
    system = (
        "你是专业小说编辑。根据问题描述，修正给定原文片段中的错误（设定矛盾/逻辑问题/文风不一致等）。"
        "直接输出修正后的正文片段（可以适当扩写使衔接自然），不要解释、不要加引号或前后缀。"
        "保持原文的叙事人称、时态和文风。"
        "**特别注意**：修正后的文本必须与前后文逻辑连贯、文风一致，不得引入新的矛盾。"
        "如果修改涉及状态/等级变化（如修为境界），确保修正后的描述与全书设定一致。"
    )
    user = f"问题原文：\n{truncate(req.evidence, 2000)}\n\n修改建议：\n{truncate(req.suggestion, 1000)}"
    if req.context:
        user += f"\n\n上下文（前后段落，修正须与此衔接）：\n{truncate(req.context, 2000)}"
    return system, [{"role": "user", "content": user}]


# ==================== 去AI味（两遍：去套路 → 自审残留 → 终稿）====================

_HUMANIZE_SYSTEM = (
    "你是去AI味润色师。原则：去AI味不是删词，而是用**具体细节、动作、感官**替代抽象套话、排比空话与万能副词。"
    "必须修正这些AI腔：①高频AI词（『宛如』『仿佛』『一抹』『一丝』『不禁』『淡淡地』『缓缓地』滥用）②"
    "弱化副词与万能修饰 ③空洞抒情与强行升华 ④对称排比与三连式 ⑤书面公文腔。"
    "**保留原意、人物语气、情节与叙事人称**，只改写遣词造句，不增删情节，不改人名设定。"
    "直接输出润色后的正文全文，不要解释、不要加标题或前后缀。"
)


def humanize_pass1(req) -> tuple[str, list[dict]]:
    user = "请对下面这段正文做去AI味润色（用具体细节替换抽象套话，去掉万能副词与排比空话）。保持原意与情节不变。\n\n"
    user += truncate(req.text, 6000)
    return _HUMANIZE_SYSTEM, [{"role": "user", "content": user}]


def humanize_pass2(req) -> tuple[str, list[dict]]:
    """第二遍：自审哪几处仍像AI，再就地改掉。"""
    system = (
        "你是去AI味终审。先在心里找出上一稿中**仍然最像AI的 1-3 处**（套话/排比/空抒情/万能副词），"
        "然后输出**整段终稿**（已就地改掉这几处）。不要列出修改说明，直接输出终稿正文全文。"
        "严禁为追求『去AI』而改变原意、情节、人物或叙事人称。"
    )
    user = "上一稿：\n" + truncate(req.text, 6000)
    return system, [{"role": "user", "content": user}]


# ==================== Beat 分解（章纲 → 分拍 → 扩写）====================

_BEATS_SYSTEM = (
    "你是网文结构师。把给定章纲拆成 4-6 个连贯的『拍』(beat)，每拍一行，格式：`序号. 目标｜冲突｜钩子`。"
    "拍子之间要有时序与因果推进，覆盖该章完整情节弧（开篇冲突→升级→转折→收尾钩子）。"
    "**只输出拍子列表**，不要解释。"
)


def chapter_beats(req) -> tuple[str, list[dict]]:
    user = ""
    if _world_block(req):
        user += f"作品设定：{_world_block(req)}\n\n"
    user += f"章节标题：{req.chapterTitle or '（未命名）'}\n章纲：\n{truncate(req.outline, 1500)}"
    if req.instruction:
        user += f"\n\n额外要求：{req.instruction}"
    return _BEATS_SYSTEM, [{"role": "user", "content": user}]

