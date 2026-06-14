"""LLM provider 抽象基类（plan §7.1 分级路由的统一接口）。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator

Message = dict  # {"role": "user"|"assistant", "content": "..."}


class LLMProvider(ABC):
    name: str
    default_model: str

    @abstractmethod
    def available(self) -> bool:
        """是否已配置（有 key）。"""

    @abstractmethod
    async def stream(
        self, system: str, messages: list[Message], model: str, temperature: float = 0.85
    ) -> AsyncIterator[str]:
        """流式生成，逐 token yield。"""

    @abstractmethod
    async def chat(
        self, system: str, messages: list[Message], model: str, temperature: float = 0.4
    ) -> str:
        """一次性生成，返回完整文本。"""
