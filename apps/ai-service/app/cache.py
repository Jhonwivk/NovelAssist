"""进程内语义缓存（plan §16 控成本手段之一）。

仅缓存**非流式**生成端点（outline/idea/title/synopsis/hook/summarize/extract/
review/style-guard）——这些输入高度重复、输出确定性强；创作类流式端点不缓存。
命中时返回缓存结果，调用方标记 AiTask.cached=true。
"""

from __future__ import annotations

from typing import Any

from .config import settings
from .embedding import cosine, embed

# key: (task_type) -> list[(vector, payload, result)]
_store: dict[str, list[tuple[list[float], str, Any]]] = {}


async def try_get(task_type: str, payload: Any) -> tuple[bool, Any]:
    """返回 (hit, result|None)。"""
    if not settings.semantic_cache_enabled:
        return False, None
    key_text = _signature(payload)
    if not key_text:
        return False, None
    vec = await embed(key_text)
    if not vec:
        return False, None
    entries = _store.get(task_type, [])
    for v, _, result in entries:
        if cosine(vec, v) >= settings.semantic_cache_threshold:
            return True, result
    return False, None


async def put(task_type: str, payload: Any, result: Any) -> None:
    if not settings.semantic_cache_enabled:
        return
    key_text = _signature(payload)
    if not key_text:
        return
    vec = await embed(key_text)
    if not vec:
        return
    _store.setdefault(task_type, []).append((vec, key_text, result))
    # 简单上限，避免内存膨胀
    if len(_store[task_type]) > 200:
        _store[task_type] = _store[task_type][-200:]


def _signature(payload: Any) -> str:
    """把请求载荷压成一个可比对的签名串（忽略 None / 空白）。"""
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload.strip()
    try:
        import json

        return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).strip()
    except Exception:
        return str(payload).strip()
