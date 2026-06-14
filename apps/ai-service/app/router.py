"""模型路由：注册 provider，按 tier 解析 (provider, model)。

plan §7.1 分级路由的雏形——阶段一做 provider 抽象 + tier 映射，
阶段四再加 Prompt Caching / 语义缓存。
"""

from __future__ import annotations

from .config import settings
from .providers.anthropic import AnthropicProvider
from .providers.base import LLMProvider
from .providers.openai_compat import OpenAICompatProvider

TIERS = ("small", "medium", "large")


class ModelRouter:
    def __init__(self) -> None:
        self.providers: dict[str, LLMProvider] = {}

        if settings.deepseek_api_key:
            self.providers["deepseek"] = OpenAICompatProvider(
                "deepseek", settings.deepseek_api_key, settings.deepseek_base_url, "deepseek-chat"
            )
        if settings.openai_api_key:
            self.providers["openai"] = OpenAICompatProvider(
                "openai", settings.openai_api_key, settings.openai_base_url, "gpt-4o-mini"
            )
        if settings.anthropic_auth_token or settings.anthropic_api_key:
            self.providers["anthropic"] = AnthropicProvider(
                api_key=settings.anthropic_api_key,
                auth_token=settings.anthropic_auth_token,
                base_url=settings.anthropic_base_url,
                default_model=settings.anthropic_default_model,
            )

    def available_list(self) -> list[str]:
        return [name for name, p in self.providers.items() if p.available()]

    def _tier_config(self, tier: str) -> tuple[str, str]:
        provider = getattr(settings, f"provider_{tier}")
        model = getattr(settings, f"model_{tier}")
        return provider, model

    def resolve(self, tier: str) -> tuple[LLMProvider, str]:
        """按 tier 解析；若配置的 provider 不可用，回退到任意可用 provider + 其默认模型。"""
        if tier not in TIERS:
            raise ValueError(f"unknown tier: {tier}")

        name, model = self._tier_config(tier)
        provider = self.providers.get(name)
        if provider and provider.available():
            return provider, model

        # 回退
        for p in self.providers.values():
            if p.available():
                return p, p.default_model

        raise RuntimeError(
            "没有可用的 LLM provider。请在 apps/ai-service/.env 配置至少一个 API Key"
            "（DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY）。"
        )


router = ModelRouter()
