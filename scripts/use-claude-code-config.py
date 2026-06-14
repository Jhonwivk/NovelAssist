#!/usr/bin/env python3
"""把本地 Claude Code 的 API 配置写入 apps/ai-service/.env。

读取 ~/.claude/settings.json 的 env 块（ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN /
ANTHROPIC_MODEL），生成 ai-service 可用的 .env，分级路由全部走 Anthropic 兼容通道。
密钥只写入本地 .env（已 gitignore），不会打印。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SETTINGS = Path(os.path.expanduser("~/.claude/settings.json"))
ENV_OUT = REPO / "apps" / "ai-service" / ".env"


def main() -> int:
    if not SETTINGS.exists():
        print(f"找不到 {SETTINGS}，无法读取 Claude Code 配置。", file=sys.stderr)
        return 1

    env = json.loads(SETTINGS.read_text()).get("env", {})
    base = env.get("ANTHROPIC_BASE_URL", "")
    token = env.get("ANTHROPIC_AUTH_TOKEN") or env.get("ANTHROPIC_API_KEY", "")
    model = (
        env.get("ANTHROPIC_MODEL")
        or env.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
        or "glm-5.2[1m]"
    )
    # 去掉 Claude Code 的上下文后缀（如 glm-5.2[1m] → glm-5.2），
    # 兼容端点不接受带方括号的别名。
    model = model.split("[")[0]

    if not token:
        print("Claude Code 配置里没有 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY。", file=sys.stderr)
        return 1

    content = f"""# 自动从本地 Claude Code 配置（~/.claude/settings.json）填入。

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL="https://api.deepseek.com"

# 复用 Claude Code 的 Anthropic 兼容通道
ANTHROPIC_AUTH_TOKEN="{token}"
ANTHROPIC_BASE_URL="{base}"
ANTHROPIC_DEFAULT_MODEL="{model}"
ANTHROPIC_API_KEY=

OPENAI_API_KEY=
OPENAI_BASE_URL="https://api.openai.com/v1"

# 分级路由：全部走 Anthropic 兼容通道
PROVIDER_SMALL="anthropic"
MODEL_SMALL="{model}"
PROVIDER_MEDIUM="anthropic"
MODEL_MEDIUM="{model}"
PROVIDER_LARGE="anthropic"
MODEL_LARGE="{model}"

CORS_ORIGINS="http://localhost:3000"
"""
    ENV_OUT.write_text(content)
    print(f"已写入 {ENV_OUT.relative_to(REPO)}")
    print(f"  base_url = {base}")
    print(f"  model    = {model}")
    print(f"  token    = <已写入，{len(token)} 字符>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
