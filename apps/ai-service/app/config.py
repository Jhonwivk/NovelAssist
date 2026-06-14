"""配置：读取 .env，实例化分级路由所需的 provider 注册表。"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # provider keys
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    anthropic_api_key: str = ""
    # 复用本地 Claude Code 的 Anthropic 兼容配置（Bearer token + 自定义 base_url）
    anthropic_auth_token: str = ""
    anthropic_base_url: str = ""
    anthropic_default_model: str = "claude-sonnet-4-6"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    # 分级路由 tier -> provider/model
    provider_small: str = "deepseek"
    model_small: str = "deepseek-chat"
    provider_medium: str = "deepseek"
    model_medium: str = "deepseek-chat"
    provider_large: str = "anthropic"
    model_large: str = "claude-sonnet-4-6"

    # 嵌入模型（语义缓存 / 检索；BigModel 走 OpenAI 兼容 v4 端点）
    embedding_model: str = "embedding-3"

    # 语义缓存阈值（cosine ≥ 此值视为命中）
    semantic_cache_threshold: float = 0.97
    semantic_cache_enabled: bool = True

    cors_origins: str = "http://localhost:3000"

    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
