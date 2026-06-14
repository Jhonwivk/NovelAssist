"""FastAPI 入口：AI 能力端点 + SSE 流式 + 语义缓存。

端点分三类：
  - 非流式 JSON（可命中语义缓存）：outline/idea/title/synopsis/hook/summarize/
    summarize-book/extract/consistency-check/review/style-guard
  - 流式 SSE（创作类，不缓存）：chapter/continue/polish/expand/rewrite/viewpoint/
    style-switch/chat
  - 工具：embed / health / cache-stats
"""

from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import cache, prompts
from .config import settings
from .embedding import embed, embed_available
from .json_utils import parse_json_loose
from .router import router
from .schemas import (
    BookSummaryRequest,
    ChapterRequest,
    ChatRequest,
    ConsistencyCheckRequest,
    ContinueRequest,
    ExtractRequest,
    HookRequest,
    IdeaRequest,
    LocalEditRequest,
    OutlineRequest,
    OutlineOptimizeRequest,
    OutlineChaptersRequest,
    PolishRequest,
    ReviewRequest,
    StyleGuardRequest,
    SummarizeRequest,
    SynopsisRequest,
    TitleRequest,
)

app = FastAPI(title="Novel AI Service", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "ai-service",
        "providers": router.available_list(),
        "embedding": True,  # 云端不可用时退回本地 n-gram 向量，恒可用
        "cache_enabled": settings.semantic_cache_enabled,
    }


# ---------------- 通用工具 ----------------

async def _sse(gen: AsyncIterator[str]) -> AsyncIterator[str]:
    """token 流 → SSE；流中异常转 error 事件。"""
    try:
        async for token in gen:
            yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:  # noqa: BLE001
        yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"


def _resolve(tier: str):
    try:
        return router.resolve(tier)
    except RuntimeError as e:
        raise _NoProvider(str(e))


class _NoProvider(Exception):
    pass


def _stream(tier: str, system: str, messages: list[dict], temperature: float):
    try:
        provider, model = router.resolve(tier)
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return StreamingResponse(
        _sse(provider.stream(system, messages, model, temperature)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _chat_cached(task_type: str, tier: str, payload, build, temperature: float = 0.5) -> dict:
    """带语义缓存的非流式生成；返回 {content, cached, usage}。无 provider → 503。"""
    import json as _json

    in_text = _signature_text(payload) + (build()[0] or "")
    try:
        hit, cached = await cache.try_get(task_type, payload)
    except Exception:
        hit, cached = False, None
    if hit:
        return {
            "content": cached,
            "cached": True,
            "usage": {"in": est_tokens(in_text), "out": est_tokens(cached or ""), "model": None, "cached": True},
        }
    try:
        provider, model = router.resolve(tier)
    except RuntimeError as e:
        raise _NoProvider(str(e))
    system, messages = build()
    text = await provider.chat(system, messages, model, temperature)
    try:
        await cache.put(task_type, payload, text)
    except Exception:
        pass
    return {
        "content": text,
        "cached": False,
        "usage": {"in": est_tokens(in_text), "out": est_tokens(text), "model": model, "cached": False},
    }


async def _json_structured(task_type: str, tier: str, payload, build, temperature: float = 0.2) -> dict:
    """同 _chat_cached，但尝试把输出解析成 JSON。返回 {result, raw, cached, usage}。"""
    res = await _chat_cached(task_type, tier, payload, build, temperature)
    parsed = parse_json_loose(res["content"])
    return {"result": parsed, "raw": res["content"], "cached": res["cached"], "usage": res["usage"]}


def _signature_text(payload) -> str:
    try:
        import json as _json

        return _json.dumps(payload, ensure_ascii=False, default=str)
    except Exception:
        return str(payload)


def est_tokens(text: str) -> int:
    """粗估 token：中文≈字数×0.6，英文≈词数。统一用 max(字符数/1.7, 词数)。"""
    if not text:
        return 0
    return max(int(len(text) / 1.7), len(text.split()))


# ================ 大纲 / 灵感 / 简介 / 钩子（非流式，缓存）================

@app.post("/outline")
async def outline_ep(req: OutlineRequest):
    try:
        r = await _chat_cached("outline", "large", req.model_dump(), lambda: prompts.outline(req), 0.6)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return r


@app.post("/outline/optimize")
async def outline_optimize_ep(req: OutlineOptimizeRequest):
    try:
        r = await _chat_cached("outline-optimize", "large", req.model_dump(), lambda: prompts.outline_optimize(req), 0.5)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return r


@app.post("/outline-chapters")
async def outline_chapters_ep(req: OutlineChaptersRequest):
    try:
        return await _json_structured("outline-chapters", "large", req.model_dump(), lambda: prompts.outline_chapters(req), 0.5)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)


@app.post("/idea")
async def idea_ep(req: IdeaRequest):
    try:
        r = await _chat_cached("idea", "medium", req.model_dump(), lambda: prompts.idea(req), 0.9)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return r


@app.post("/title")
async def title_ep(req: TitleRequest):
    try:
        r = await _chat_cached("title", "small", req.model_dump(), lambda: prompts.titles(req), 0.8)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return r


@app.post("/synopsis")
async def synopsis_ep(req: SynopsisRequest):
    try:
        r = await _chat_cached("synopsis", "medium", req.model_dump(), lambda: prompts.synopsis(req), 0.7)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return r


@app.post("/hook")
async def hook_ep(req: HookRequest):
    try:
        r = await _chat_cached("hook", "medium", req.model_dump(), lambda: prompts.hook(req), 0.85)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return r


# ================ 摘要（L1/L2/L3/L4，非流式，缓存）================

@app.post("/summarize")
async def summarize_ep(req: SummarizeRequest):
    try:
        r = await _chat_cached("summarize", "small", req.model_dump(), lambda: prompts.summarize(req), 0.3)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return {"summary": r["content"], "cached": r["cached"]}


@app.post("/summarize-book")
async def summarize_book_ep(req: BookSummaryRequest):
    try:
        r = await _chat_cached("summarize-book", "medium", req.model_dump(), lambda: prompts.book_summary(req), 0.4)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    return {"summary": r["content"], "cached": r["cached"]}


# ================ 创作类（流式，不缓存）================

@app.post("/chapter")
async def chapter_ep(req: ChapterRequest):
    system, messages = prompts.chapter(req)
    return _stream("medium", system, messages, 0.85)


@app.post("/continue")
async def continue_ep(req: ContinueRequest):
    system, messages = prompts.continue_writing(req)
    return _stream("medium", system, messages, 0.85)


@app.post("/polish")
async def polish_ep(req: PolishRequest):
    system, messages = prompts.polish(req)
    return _stream("medium", system, messages, 0.7)


@app.post("/expand")
async def expand_ep(req: LocalEditRequest):
    system, messages = prompts.local_edit(req, "expand")
    return _stream("medium", system, messages, 0.8)


@app.post("/rewrite")
async def rewrite_ep(req: LocalEditRequest):
    system, messages = prompts.local_edit(req, "rewrite")
    return _stream("medium", system, messages, 0.7)


@app.post("/viewpoint")
async def viewpoint_ep(req: LocalEditRequest):
    system, messages = prompts.local_edit(req, "viewpoint")
    return _stream("medium", system, messages, 0.7)


@app.post("/style-switch")
async def style_switch_ep(req: LocalEditRequest):
    system, messages = prompts.local_edit(req, "style")
    return _stream("medium", system, messages, 0.7)


@app.post("/chat")
async def chat_ep(req: ChatRequest):
    system, messages = prompts.chat(req)
    return _stream("medium", system, messages, 0.7)


# ================ 一致性引擎 L1 抽取 / L4 语义（结构化 JSON）================

@app.post("/extract")
async def extract_ep(req: ExtractRequest):
    try:
        return await _json_structured("extract", "small", req.model_dump(), lambda: prompts.extract(req), 0.1)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)


@app.post("/consistency-check")
async def consistency_check_ep(req: ConsistencyCheckRequest):
    try:
        return await _json_structured("consistency-check", "large", req.model_dump(), lambda: prompts.consistency_check(req), 0.2)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)


# ================ 审稿 / 文风守卫（结构化 JSON）================

@app.post("/review")
async def review_ep(req: ReviewRequest):
    try:
        return await _json_structured("review", "medium", req.model_dump(), lambda: prompts.review(req), 0.3)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)


@app.post("/style-guard")
async def style_guard_ep(req: StyleGuardRequest):
    try:
        return await _json_structured("style-guard", "small", req.model_dump(), lambda: prompts.style_guard(req), 0.2)
    except _NoProvider as e:
        return JSONResponse({"error": str(e)}, status_code=503)


# ================ 工具：嵌入 / 缓存统计 ================

@app.post("/embed")
async def embed_ep(body: dict):
    text = body.get("text", "")
    vec = await embed(text)
    if not vec:
        return JSONResponse({"error": "embedding unavailable"}, status_code=503)
    return {"embedding": vec}


@app.get("/cache-stats")
def cache_stats() -> dict:
    return {k: len(v) for k, v in cache._store.items()}
