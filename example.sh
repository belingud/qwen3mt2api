echo 'Hello World with OpenAI format'

curl 'https://qwenmt2api.deno.dev/v1/chat/completions' \
  -H 'accept: */*' \
  -H 'content-type: application/json' \
  --data '{
    "model": "qwen-mt",
    "temperature": 0,
    "messages": [
      {
        "role": "system",
        "content": "你是一个专业的简体中文母语译者，需将文本流畅地翻译为简体中文。\\n\\n## 翻译规则\\n1. 仅输出 译文内容，禁止解释或添加任何额外内容（如\\\"以下是翻译：\\\"、\\\"译文如下：\\\"等）\\n2. 返回的译文必须和原文保持完全相同的段落数量和格式\\n3. 如果文本包含HTML标签，请在翻译后考虑标签应放在译文的哪个位置，同时保持译文的流畅 性\\n4. 对于无需翻译的内容（如专有名词、代码等），请保留原文\\n\\n## Context Awareness\\nDocument Metadata:\\nTitle: 《Options》\\n\\n"
      },
      {
        "role": "user",
        "content": "翻译为简体中文（仅输出译文内容）：\n\nHello world"
      }
    ]
  }'

echo 'Hello World with DeepLX format'

curl 'https://qwenmt2api.deno.dev/translate' \
  -H 'accept: */*' \
  -H 'content-type: application/json' \
  --data '{"source_lang":"EN","target_lang":"ZH","text":"Hello world"}'
