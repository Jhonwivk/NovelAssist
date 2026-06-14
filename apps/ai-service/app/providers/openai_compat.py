"""OpenAI 兼容 provider：同时覆盖 OpenAI 与 DeepSeek（仅 base_url/key 不同）。"""

from __future__ import annotations

from typing import AsyncIterator

from openai import AsyncOpenAI

from .base import LLMProvider, Message


class OpenAICompatProvider(LLMProvider):
    def __init__(self, name: str, api_key: str, base_url: str, default_model: str) -> None:
        self.name = name
        self.default_model = default_model
        self.api_key = api_key
        self.base_url = base_url
        self._client: AsyncOpenAI | None = (
            AsyncOpenAI(api_key=api_key, base_url=base_url) if api_key else None
        )

    def available(self) -> bool:
        return self._client is not None

    def _require(self) -> AsyncOpenAI:
        if self._client is None:
            raise RuntimeError(f"provider {self.name} 未配置 API Key")
        return self._client

    async def stream(
        self, system: str, messages: list[Message], model: str, temperature: float = 0.85
    ) -> AsyncIterator[str]:
        client = self._require()
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, *messages],
            temperature=temperature,
            stream=True,
        )
        async for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def chat(
        self, system: str, messages: list[Message], model: str, temperature: float = 0.4
    ) -> str:
        client = self._require()
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, *messages],
            temperature=temperature,
        )
        return response.choices[0].message.content or ""
