"""请求模型（字段名与 NestJS 发来的 camelCase payload 对齐）。"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class NovelBase(BaseModel):
    title: Optional[str] = None
    genre: Optional[str] = None
    synopsis: Optional[str] = None
    worldviewText: Optional[str] = None
    # 结构化预设（plan 新建作品流程）
    theme: Optional[str] = None  # 题材：重生/末世/系统...
    trope: Optional[str] = None  # 叙事套路：废柴逆袭/扮猪吃虎...
    coreSetting: Optional[str] = None  # 核心设定/金手指
    audience: Optional[str] = None  # 受众：男频/女频/全年龄/青少年


class OutlineRequest(NovelBase):
    instruction: Optional[str] = None


class ChapterRequest(NovelBase):
    chapterTitle: Optional[str] = None
    outline: Optional[str] = None
    previousSummary: Optional[str] = None
    context: Optional[str] = None  # 后端组装的相关记忆 / Bible 实体
    instruction: Optional[str] = None
    targetWords: Optional[int] = None


class ContinueRequest(NovelBase):
    content: str = ""
    context: Optional[str] = None
    instruction: Optional[str] = None


class PolishRequest(NovelBase):
    selection: str = ""
    context: Optional[str] = None
    instruction: Optional[str] = None


class SummarizeRequest(BaseModel):
    novelId: Optional[int] = None
    chapterId: Optional[int] = None
    title: Optional[str] = None
    content: str = ""


class ChatRequest(NovelBase):
    message: str = ""
    context: Optional[str] = None  # 由后端组装的记忆 + Bible 上下文
    history: list[dict] = Field(default_factory=list)


# ---------- 阶段二：大纲 / 灵感 / 局部操作 ----------

class OutlineRequest(NovelBase):
    instruction: Optional[str] = None
    scope: str = "master"  # master | volume | chapter


class OutlineOptimizeRequest(NovelBase):
    currentOutline: str = ""
    instruction: Optional[str] = None


class OutlineChaptersRequest(NovelBase):
    masterOutline: Optional[str] = None
    count: int = 10
    instruction: Optional[str] = None


class IdeaRequest(BaseModel):
    genre: Optional[str] = None
    keywords: Optional[str] = None
    instruction: Optional[str] = None


class TitleRequest(NovelBase):
    count: int = 5
    instruction: Optional[str] = None


class SynopsisRequest(NovelBase):
    instruction: Optional[str] = None


class HookRequest(NovelBase):
    instruction: Optional[str] = None


class BookSummaryRequest(NovelBase):
    volumeSummaries: list[str] = Field(default_factory=list)
    chapterSummaries: list[str] = Field(default_factory=list)


class LocalEditRequest(NovelBase):
    text: str = ""
    instruction: Optional[str] = None
    viewpoint: Optional[str] = None  # 视角转换目标
    style: Optional[str] = None  # 风格切换目标


# ---------- 阶段三：一致性引擎 ----------

class ExtractRequest(BaseModel):
    title: Optional[str] = None
    content: str = ""
    knownEntities: list[str] = Field(default_factory=list)


class ConsistencyCheckRequest(NovelBase):
    chapterTitle: Optional[str] = None
    content: str = ""
    priorContext: Optional[str] = None  # 前文事实 / 设定摘要
    characters: list[dict] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)


# ---------- 阶段四：文风 / 审稿 ----------

class ReviewRequest(BaseModel):
    content: str = ""
    instruction: Optional[str] = None


class StyleGuardRequest(BaseModel):
    text: str = ""
    traits: Optional[str] = None
    bannedWords: list[str] = Field(default_factory=list)
    samples: list[str] = Field(default_factory=list)
