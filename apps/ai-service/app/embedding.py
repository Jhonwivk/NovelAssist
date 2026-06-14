"""嵌入向量生成（语义缓存 / 检索用）。

策略：
  1. 优先用云端嵌入（BigModel embedding-3，OpenAI 兼容 v4）——更接近真正语义。
  2. 云端不可用（余额/网络）时，退回**本地字符 n-gram 哈希向量**（无外部依赖、
     零成本、确定性），用于近重复检测（缓存命中）与词法相关检索。

进程内固定一种模式（避免不同维度向量混算 cosine）：首次调用探测云端，成功则全程云端，否则全程本地。
"""

from __future__ import annotations

import hashlib

from openai import AsyncOpenAI

from .config import settings

DIM = 1024
_api_client: AsyncOpenAI | None = None
_mode: str | None = None  # "api" | "local"


def _get_api_client() -> AsyncOpenAI | None:
    global _api_client
    if _api_client is not None:
        return _api_client
    token = settings.anthropic_auth_token or settings.openai_api_key
    if not token:
        return None
    base = (
        "https://open.bigmodel.cn/api/paas/v4"
        if settings.anthropic_auth_token
        else settings.openai_base_url
    )
    _api_client = AsyncOpenAI(api_key=token, base_url=base)
    return _api_client


def _local_embed(text: str) -> list[float]:
    """字符 1/2/3-gram 特征哈希向量（带符号），单位化。"""
    s = (text or "").strip()
    if not s:
        return []
    vec = [0.0] * DIM
    grams: set[str] = set()
    for n in (1, 2, 3):
        if len(s) >= n:
            for i in range(len(s) - n + 1):
                grams.add(s[i : i + n])
    for g in grams:
        h = int(hashlib.md5(g.encode("utf-8")).hexdigest(), 16) % DIM
        vec[h] += 1.0 if (h % 2 == 0) else -1.0
    norm = sum(v * v for v in vec) ** 0.5
    if norm == 0:
        return []
    return [v / norm for v in vec]


async def embed(text: str) -> list[float]:
    """返回单位向量；不可用返回 []。"""
    global _mode
    if not text or not text.strip():
        return []

    if _mode is None:
        # 探测云端
        client = _get_api_client()
        if client is not None:
            try:
                resp = await client.embeddings.create(model=settings.embedding_model, input=text[:8000])
                _mode = "api"
                return resp.data[0].embedding
            except Exception:
                _mode = "local"
        else:
            _mode = "local"

    if _mode == "api":
        client = _get_api_client()
        try:
            assert client is not None
            resp = await client.embeddings.create(model=settings.embedding_model, input=text[:8000])
            return resp.data[0].embedding
        except Exception:
            _mode = "local"  # 降级，后续走本地

    return _local_embed(text)


async def embed_available() -> bool:
    return True  # 本地向量恒可用；云端探测在首次 embed 时进行


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    return dot  # 向量已单位化，dot 即 cosine
