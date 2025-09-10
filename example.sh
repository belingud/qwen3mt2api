echo 'Hello World with OpenAI format'

curl 'https://qwenmt2api.deno.dev/v1/chat/completions' \
    -H 'accept: */*' \
    -H 'accept-language: zh-CN,zh;q=0.9' \
    -H 'content-type: application/json' \
    -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' \
    --data-raw @- <<'JSON'
{
  "model": "qwen-mt",
  "temperature": 0,
  "messages": [
    {
      "role": "system",
      "content": "你是一个专业的简体中文母语译者..."
    },
    {
      "role": "user",
      "content": "翻译为简体中文（仅输出译文内容）：\n\nHello world"
    }
  ]
}
JSON

echo 'Hello World with DeepLX format'

curl 'https://qwenmt2api.deno.dev/translate' \
    -H 'accept: */*' \
    -H 'content-type: application/json' \
    -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' \
    --data-raw @- <<'JSON'
{"source_lang":"EN","target_lang":"ZH","text":"Hello world"}
JSON
