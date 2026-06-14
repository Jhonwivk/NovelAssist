"""Anthropic / Claude Code 兼容 provider（messages API）。

支持两种鉴权（择一）：
  - auth_token  → Authorization: Bearer（Claude Code 的 ANTHROPIC_AUTH_TOKEN，如智谱 BigModel）
  - api_key     → x-api-key（官方 Anthropic）
可自定义 base_url，指向任意 Anthropic 协议兼容端点。
"""

from __future__ import annotations

from typing import AsyncIterator

from anthropic import AsyncAnthropic

from .base import LLMProvider, Message


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(
        self,
        api_key: str = "",
        auth_token: str = "",
        base_url: str = "",
        default_model: str = "claude-sonnet-4-6",
    ) -> None:
        self.default_model = default_model
        self._has_creds = bool(auth_token or api_key)

        kwargs: dict = {}
        if base_url:
            kwargs["base_url"] = base_url
        if auth_token:
            kwargs["auth_token"] = auth_token
        elif api_key:
            kwargs["api_key"] = api_key

        self._client: AsyncAnthropic | None = AsyncAnthropic(**kwargs) if self._has_creds else None

    def available(self) -> bool:
        return self._client is not None

    def _require(self) -> AsyncAnthropic:
        if self._client is None:
            raise RuntimeError("provider anthropic 未配置（需 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY）")
        return self._client

    async def stream(
        self, system: str, messages: list[Message], model: str, temperature: float = 0.85
    ) -> AsyncIterator[str]:
        client = self._require()
        async with client.messages.stream(
            model=model,
            system=system,
            messages=messages,
            max_tokens=4096,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def chat(
        self, system: str, messages: list[Message], model: str, temperature: float = 0.4
    ) -> str:
        client = self._require()
        response = await client.messages.create(
            model=model,
            system=system,
            messages=messages,
            max_tokens=4096,
            temperature=temperature,
        )
        return "".join(block.text for block in response.content if hasattr(block, "text"))
