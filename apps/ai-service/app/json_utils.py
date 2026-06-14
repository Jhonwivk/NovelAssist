"""从 LLM 输出中宽松解析 JSON（去代码块、截取首个 {...}/[...]）。"""

from __future__ import annotations

import json
import re


def parse_json_loose(text: str | None) -> object | None:
    if not text:
        return None
    s = text.strip()

    # 去掉 ```json ... ``` / ``` ... ``` 代码块
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", s)
    if fence:
        s = fence.group(1).strip()

    try:
        return json.loads(s)
    except Exception:
        pass

    # 截取首个 { ... } 或 [ ... ]
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = s.find(open_ch)
        end = s.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            chunk = s[start : end + 1]
            try:
                return json.loads(chunk)
            except Exception:
                continue
    return None
