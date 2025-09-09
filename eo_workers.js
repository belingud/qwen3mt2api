// Interfaces are removed as they are TypeScript specific and not needed in JS.

class QwenService {
  constructor() {
    this.client = fetch;
    this.baseURL = "https://qwen-qwen3-mt-demo.ms.show";
    this.langMap = {
      自动检测: "auto",
      自动: "auto",
      简体中文: "ZH",
      英语: "EN",
      英文: "EN",
      auto: "auto",
      ZH: "ZH",
      EN: "EN",
    };
    this.rateLimiter = new RateLimiter(2);
  }

  async translate(req) {
    const translations = [];
    const sourceLang = this.mapLanguage(req.source_lang || "");
    const targetLang = this.mapLanguage(req.target_lang);

    for (const text of req.text) {
      const [result, detectedLang] = await this.translateSingleText(text, sourceLang, targetLang);
      translations.push({
        detected_source_language: detectedLang,
        text: result,
      });
    }

    return { translations };
  }

  async deeplxTranslate(req) {
    const requestId = Date.now();

    const sourceLang = this.mapLanguage(req.source_lang || "");
    const targetLang = this.mapLanguage(req.target_lang);

    try {
      const [result, _] = await this.translateSingleText(req.text, sourceLang, targetLang);
      return {
        code: 200,
        id: requestId,
        data: result,
      };
    } catch (error) {
      return {
        code: 500,
        id: requestId,
        data: "",
        message: "Translation failed: " + (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async chatComplete(req) {
    const lastMessage = req.messages[req.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user" || !lastMessage.content) {
      throw new Error("Invalid chat completion request: last message must be from user and have content.");
    }

    const textToTranslate = lastMessage.content;

    // 使用 translation_options 参数
    const sourceLang = req.translation_options?.source_lang || "auto";
    const targetLang = req.translation_options?.target_lang || "ZH";

    const [translatedText, _] = await this.translateSingleText(
      textToTranslate,
      this.mapLanguage(sourceLang),
      this.mapLanguage(targetLang)
    );

    const completionId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    return {
      id: completionId,
      object: "chat.completion",
      created: created,
      model: req.model || "qwen-mt",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: translatedText,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: textToTranslate.length, // 简化计算
        completion_tokens: translatedText.length, // 简化计算
        total_tokens: textToTranslate.length + translatedText.length, // 简化计算
      },
    };
  }

  mapLanguage(lang) {
    const qwenLangMap = {
      auto: "自动检测",
      ZH: "简体中文",
      EN: "英语",
    };

    if (this.langMap[lang]) {
      if (qwenLangMap[this.langMap[lang]]) {
        return qwenLangMap[this.langMap[lang]];
      }
      return this.langMap[lang];
    }

    return lang;
  }

  async translateSingleText(text, sourceLang, targetLang) {
    return this.rateLimiter.run(async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          console.log(`Retrying translation attempt ${attempt + 1}`);
        }

        try {
          const result = await this.attemptTranslation(text, sourceLang, targetLang);
          return [result, sourceLang || "auto"];
        } catch (error) {
          lastError = error;
          if (
            !(error instanceof Error) ||
            (!error.message.includes("Session not found") && !error.message.includes("unexpected_error"))
          ) {
            break;
          }
        }
      }

      throw new Error(`translation failed after 3 attempts: ${lastError?.message || "unknown error"}`);
    });
  }

  async attemptTranslation(text, sourceLang, targetLang) {
    const sessionHash = crypto.randomUUID().replace(/-/g, "").substring(0, 12);

    const joinReq = {
      data: [text, sourceLang, targetLang],
      event_data: null,
      fn_index: 2,
      trigger_id: 11,
      dataType: ["textbox", "dropdown", "dropdown"],
      session_hash: sessionHash,
    };

    const joinURL = `${this.baseURL}/gradio_api/queue/join?t=${Date.now()}&__theme=light&backend_url=%2F`;

    const headers = {
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Content-Type": "application/json",
      Origin: this.baseURL,
      Priority: "u=1, i",
      Referer: `${this.baseURL}/?t=${Date.now()}&__theme=light&backend_url=/`,
      "Sec-Ch-Ua": `"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"`,
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": `"macOS"`,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Storage-Access": "active",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
      "X-Studio-Token": "",
    };

    const joinResp = await this.client(joinURL, {
      method: "POST",
      headers,
      body: JSON.stringify(joinReq),
    });

    if (!joinResp.ok) {
      throw new Error(`failed to join queue: ${await joinResp.text()}`);
    }

    const respBody = await joinResp.text();
    console.log("Join response:", respBody);

    let joinResult;
    try {
      joinResult = JSON.parse(respBody);
    } catch (error) {
      throw new Error(
        `failed to parse join response: ${error instanceof Error ? error.message : String(error)}, body: ${respBody}`
      );
    }

    if (!joinResult.event_id) {
      throw new Error(`failed to join queue, response: ${respBody}`);
    }

    const dataURL = `${this.baseURL}/gradio_api/queue/data?session_hash=${sessionHash}&studio_token=`;

    const dataHeaders = {
      Accept: "text/event-stream",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Content-Type": "application/json",
      Priority: "u=1, i",
      Referer: `${this.baseURL}/?t=${Date.now()}&__theme=light&backend_url=/`,
      "Sec-Ch-Ua": `"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"`,
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": `"macOS"`,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Storage-Access": "active",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
      "X-Studio-Token": "",
    };

    const dataResp = await this.client(dataURL, {
      method: "GET",
      headers: dataHeaders,
    });

    if (!dataResp.body) {
      throw new Error("No response body from data stream.");
    }

    const result = await this.parseEventStream(dataResp);

    return result;
  }

  async parseEventStream(response) {
    if (!response.body) {
      throw new Error("No response body from data stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        console.debug("Event stream chunk:", chunk);

        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const data = line.substring(6);
            if (data === "[DONE]") {
              break;
            }

            let eventData;
            try {
              eventData = JSON.parse(data);
            } catch (error) {
              console.debug("Failed to parse event data:", data, "error:", error);
              continue;
            }

            console.debug("Parsed event data:", eventData);

            if (typeof eventData.msg === "string") {
              if (eventData.msg === "unexpected_error") {
                if (typeof eventData.message === "string") {
                  throw new Error(`unexpected_error: ${eventData.message}`);
                }
                throw new Error("unexpected_error occurred");
              }

              if (eventData.msg === "process_completed") {
                if (eventData.output && typeof eventData.output === "object") {
                  if (typeof eventData.output.error === "string") {
                    throw new Error(`process_error: ${eventData.output.error}`);
                  }

                  if (Array.isArray(eventData.output.data) && eventData.output.data.length > 0) {
                    if (typeof eventData.output.data[0] === "string") {
                      return eventData.output.data[0];
                    }
                  }
                }
              }
            }
          }
        }
      }

      throw new Error("no translation result found");
    } finally {
      reader.releaseLock();
    }
  }
}

class RateLimiter {
  constructor(concurrent) {
    this.queue = [];
    this.concurrent = concurrent;
    this.active = 0;
  }

  async run(fn) {
    return new Promise((resolve, reject) => {
      const task = () => {
        this.active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.next();
          });
      };

      if (this.active < this.concurrent) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  next() {
    if (this.queue.length > 0 && this.active < this.concurrent) {
      this.queue.shift()();
    }
  }
}

class AuthMiddleware {
  constructor() {
    this.enabled = env.AUTH_ENABLED === "true";
    this.validKeys = new Set();
    this.loadAPIKeys();
  }

  loadAPIKeys() {
    const apiKey = env.API_KEY;
    if (apiKey) {
      const keys = apiKey.split(",");
      for (const key of keys) {
        const trimmedKey = key.trim();
        if (trimmedKey) {
          this.validKeys.add(trimmedKey);
        }
      }
    }

    if (this.enabled && this.validKeys.size === 0) {
      this.validKeys.add("sk-default");
      console.warn("No API keys configured, using default key: sk-default");
    }
  }

  extractAPIKey(req) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      if (authHeader.startsWith("DeepL-Auth-Key ")) {
        return authHeader.substring(15);
      }
      if (authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
      }
    }

    const apiKeyHeader = req.headers.get("X-API-Key");
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    const url = new URL(req.url);
    const apiKeyParam = url.searchParams.get("api_key");
    if (apiKeyParam) {
      return apiKeyParam;
    }

    return "";
  }

  validateKey(key) {
    if (!key) {
      return false;
    }
    return this.validKeys.has(key);
  }

  unauthorized(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.includes("/v2/translate")) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized: Invalid or missing API key",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    } else if (path.includes("/translate") && !path.includes("/api/")) {
      return new Response(
        JSON.stringify({
          code: 401,
          id: Date.now(),
          data: "",
          message: "Unauthorized: Invalid or missing API key",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          code: 401,
          message: "Unauthorized: Missing or invalid API key",
          data: "",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  middleware(req, handler) {
    if (!this.enabled) {
      return handler(req);
    }

    const apiKey = this.extractAPIKey(req);

    if (!this.validateKey(apiKey)) {
      return this.unauthorized(req);
    }

    return handler(req);
  }
}

class CORSMiddleware {
  middleware(req, handler) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    return handler(req).then((response) => {
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    });
  }
}

// 修改: 使用 addEventListener 作为入口点 [[11]]
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

// 修改: 定义独立的请求处理函数
async function handleRequest(request) {
  const qwenService = new QwenService();
  // 修改: 创建 AuthMiddleware 实例时不再传递 env
  const authMiddleware = new AuthMiddleware();
  const corsMiddleware = new CORSMiddleware();

  const handler = (req) => {
    return corsMiddleware.middleware(req, async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/" && req.method === "GET") {
        const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QWenMT API 服务</title>
    <style>
        :root {
            --primary-color: #3498db;
            --secondary-color: #2c3e50;
            --success-color: #27ae60;
            --warning-color: #f39c12;
            --danger-color: #e74c3c;
            --light-bg: #f8f9fa;
            --dark-bg: #2c3e50;
            --border-radius: 8px;
            --box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            padding: 30px 20px;
            color: white;
            animation: fadeIn 1s ease-in;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .header p {
            font-size: 1.2rem;
            opacity: 0.9;
            max-width: 600px;
            margin: 0 auto;
        }
        
        .card {
            background: white;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            padding: 30px;
            margin-bottom: 30px;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            animation: slideUp 0.5s ease-out;
        }
        
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 6px 16px rgba(0,0,0,0.15);
        }
        
        h2 {
            color: var(--secondary-color);
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--primary-color);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        h2 i {
            font-size: 1.5em;
        }
        
        .endpoint {
            background-color: var(--light-bg);
            border-left: 4px solid var(--primary-color);
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 0 var(--border-radius) var(--border-radius) 0;
        }
        
        .endpoint-title {
            font-weight: bold;
            color: var(--secondary-color);
            margin-bottom: 8px;
            font-size: 1.1em;
        }
        
        .endpoint-desc {
            color: #7f8c8d;
            font-size: 0.95em;
            margin-bottom: 15px;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.8em;
            font-weight: bold;
            margin-left: 10px;
        }
        
        .badge-post {
            background-color: #e8f4f8;
            color: var(--primary-color);
        }
        
        details {
            margin-top: 15px;
            border: 1px solid #eee;
            border-radius: var(--border-radius);
            padding: 15px;
        }
        
        summary {
            cursor: pointer;
            font-weight: bold;
            color: var(--primary-color);
            outline: none;
        }
        
        summary:hover {
            text-decoration: underline;
        }
        
        pre {
            background-color: #2c3e50;
            color: #f8f9fa;
            padding: 15px;
            border-radius: var(--border-radius);
            overflow-x: auto;
            font-size: 0.9em;
            margin-top: 10px;
        }
        
        .auth-info {
            background-color: #fff8e1;
            border-left: 4px solid var(--warning-color);
            padding: 20px;
            margin: 20px 0;
            border-radius: 0 var(--border-radius) var(--border-radius) 0;
        }
        
        .env-vars {
            background-color: #e8f4f8;
            border-left: 4px solid var(--primary-color);
            padding: 20px;
            margin: 20px 0;
            border-radius: 0 var(--border-radius) var(--border-radius) 0;
        }
        
        ul {
            padding-left: 20px;
            margin: 10px 0;
        }
        
        li {
            margin-bottom: 8px;
        }
        
        code {
            background-color: #f1f1f1;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 0.9em;
        }
        
        .health-check {
            text-align: center;
            margin: 30px 0;
        }
        
        .btn {
            display: inline-block;
            background-color: var(--success-color);
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: var(--border-radius);
            transition: background-color 0.3s, transform 0.2s;
            font-weight: bold;
            border: none;
            cursor: pointer;
            font-size: 1rem;
        }
        
        .btn:hover {
            background-color: #219653;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        
        .version {
            text-align: center;
            color: rgba(255,255,255,0.8);
            margin-top: 30px;
            padding: 20px;
            font-size: 0.9em;
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        
        .feature-card {
            background: white;
            border-radius: var(--border-radius);
            padding: 20px;
            text-align: center;
            box-shadow: var(--box-shadow);
        }
        
        .feature-card i {
            font-size: 2.5rem;
            color: var(--primary-color);
            margin-bottom: 15px;
        }
        
        .feature-card h3 {
            color: var(--secondary-color);
            margin-bottom: 10px;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideUp {
            from { 
                opacity: 0;
                transform: translateY(30px);
            }
            to { 
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .header p {
                font-size: 1rem;
            }
            
            .card {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌍 QWenMT API 服务</h1>
            <p>基于通义千问的多格式翻译 API 服务，兼容 DeepLX/DeepL API/原生格式/OpenAI 格式</p>
        </div>
        
        <div class="features">
            <div class="feature-card">
                <div>🚀</div>
                <h3>高性能</h3>
                <p>基于通义千问MT大模型，提供高质量翻译</p>
            </div>
            <div class="feature-card">
                <div>🔄</div>
                <h3>多格式兼容</h3>
                <p>支持 DeepLX/DeepL API/原生格式/OpenAI 格式</p>
            </div>
            <div class="feature-card">
                <div>🛡️</div>
                <h3>安全认证</h3>
                <p>多种认证方式，保护您的 API 使用</p>
            </div>
        </div>
        
        <div class="card">
            <h2>🔐 认证方式</h2>
            <p>本服务支持多种认证方式：</p>
            <ul>
                <li><strong>Authorization Header</strong>: <code>Authorization: DeepL-Auth-Key [API_KEY]</code></li>
                <li><strong>Authorization Header</strong>: <code>Authorization: Bearer [API_KEY]</code></li>
                <li><strong>Custom Header</strong>: <code>X-API-Key: [API_KEY]</code></li>
                <li><strong>Query Parameter</strong>: <code>?api_key=[API_KEY]</code></li>
            </ul>
            
            <div class="env-vars">
                <h3>环境变量设置</h3>
                <p>可以通过以下环境变量配置服务：</p>
                <ul>
                    <li><code>AUTH_ENABLED</code>: 设置为 <code>true</code> 启用认证，默认为 <code>false</code></li>
                    <li><code>API_KEY</code>: 单个API密钥</li>
                    <li><code>API_KEYS</code>: 多个API密钥，用逗号分隔</li>
                </ul>
                <p>示例设置：</p>
                <pre>export AUTH_ENABLED=true
export API_KEY=sk-your-api-key
# 或者设置多个key
export API_KEYS=sk-key1,sk-key2,sk-key3</pre>
            </div>
            
            <h3>认证请求示例</h3>
            <details>
                <summary>使用 Authorization Header</summary>
                <pre>curl -X POST https://your-worker.your-subdomain.workers.dev/translate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: DeepL-Auth-Key sk-your-api-key" \\
  -d '{
  "text": "Hello world",
  "source_lang": "auto",
  "target_lang": "ZH"
}'</pre>
            </details>
            
            <details>
                <summary>使用 X-API-Key Header</summary>
                <pre>curl -X POST https://your-worker.your-subdomain.workers.dev/translate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: sk-your-api-key" \\
  -d '{
  "text": "Hello world",
  "source_lang": "auto",
  "target_lang": "ZH"
}'</pre>
            </details>
            
            <details>
                <summary>使用 Query Parameter</summary>
                <pre>curl -X POST "https://your-worker.your-subdomain.workers.dev/translate?api_key=sk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
  "text": "Hello world",
  "source_lang": "auto",
  "target_lang": "ZH"
}'</pre>
            </details>
        </div>
        
        <div class="card">
            <h2>🚀 API 端点</h2>
            
            <div class="endpoint">
                <div class="endpoint-title">
                    DeepLX 兼容接口 <span class="badge badge-post">POST</span>
                </div>
                <div class="endpoint-desc">/translate</div>
                <p>兼容 DeepLX 格式的翻译接口，适合需要替代方案的应用。</p>
                <details>
                    <summary>请求示例</summary>
                    <pre>curl -X POST https://your-worker.your-subdomain.workers.dev/translate \\
  -H "Content-Type: application/json" \\
  -d '{
  "text": "Hello world",
  "source_lang": "auto",
  "target_lang": "ZH"
}'</pre>
                </details>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-title">
                    DeepL 兼容接口 <span class="badge badge-post">POST</span>
                </div>
                <div class="endpoint-desc">/v2/translate</div>
                <p>兼容 DeepL API v2 格式的翻译接口。</p>
                <details>
                    <summary>请求示例</summary>
                    <pre>curl -X POST https://your-worker.your-subdomain.workers.dev/v2/translate \\
  -H "Content-Type: application/json" \\
  -d '{
  "text": ["Hello world"],
  "source_lang": "auto",
  "target_lang": "ZH"
}'</pre>
                </details>
            </div>
            
            <div class="endpoint">
                <div class="endpoint-title">
                    原生 API 接口 <span class="badge badge-post">POST</span>
                </div>
                <div class="endpoint-desc">/api/translate</div>
                <p>本服务原生的翻译接口，功能与 /v2/translate 相同。</p>
                <details>
                    <summary>请求示例</summary>
                    <pre>curl -X POST https://your-worker.your-subdomain.workers.dev/api/translate \\
  -H "Content-Type: application/json" \\
  -d '{
  "text": ["Hello world"],
  "source_lang": "auto",
  "target_lang": "ZH"
}'</pre>
                </details>
            </div>

            <div class="endpoint">
                <div class="endpoint-title">
                    OpenAI Chat 兼容接口 <span class="badge badge-post">POST</span>
                </div>
                <div class="endpoint-desc">/v1/chat/completions</div>
                <p>兼容 OpenAI Chat Completions API 格式的接口。</p>
                <details>
                    <summary>请求示例</summary>
                    <pre>curl -X POST https://your-worker.your-subdomain.workers.dev/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -d '{
  "model": "qwen-mt",
  "messages": [
    {
      "role": "user",
      "content": "Hello world"
    }
  ],
  "translation_options": {
    "source_lang": "auto",
    "target_lang": "ZH"
  }
}'</pre>
                    <p><strong>translation_options 参数说明：</strong></p>
                    <ul>
                        <li><code>source_lang</code>: 源语言代码，默认为 "auto" (自动检测)</li>
                        <li><code>target_lang</code>: 目标语言代码，默认为 "ZH" (中文)</li>
                        <li>支持的语言代码：EN (英语), ZH (中文), JA (日语), KO (韩语), FR (法语), ES (西班牙语), RU (俄语), DE (德语) 等</li>
                    </ul>
                </details>
            </div>
        </div>
        
        <div class="health-check">
            <a href="/health" class="btn">检查服务状态</a>
        </div>
        
    </div>
</body>
</html>`;
        return new Response(htmlContent, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/health" && req.method === "GET") {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "qwenmtapi",
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        if (url.pathname === "/translate") {
          return authMiddleware.middleware(req, async (req) => {
            try {
              const body = await req.json();
              if (!body.text || body.text.trim() === "") {
                return new Response(
                  JSON.stringify({
                    code: 400,
                    id: Date.now(),
                    data: "",
                    message: "Bad Request: 请输入要翻译的文本",
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }

              if (!body.target_lang) {
                return new Response(
                  JSON.stringify({
                    code: 400,
                    id: Date.now(),
                    data: "",
                    message: "Bad Request: 请选择目标语言",
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }

              const result = await qwenService.deeplxTranslate(body);
              return new Response(JSON.stringify(result), {
                status: result.code,
                headers: { "Content-Type": "application/json" },
              });
            } catch (error) {
              return new Response(
                JSON.stringify({
                  code: 400,
                  id: Date.now(),
                  data: "",
                  message: "Bad Request: " + (error instanceof Error ? error.message : String(error)),
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          });
        }

        if (url.pathname === "/v2/translate" || url.pathname === "/api/translate") {
          return authMiddleware.middleware(req, async (req) => {
            try {
              const body = await req.json();
              if (!body.text || body.text.length === 0 || body.text.some((t) => !t || t.trim() === "")) {
                return new Response(
                  JSON.stringify({
                    error: "Bad request: 请输入要翻译的文本",
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }

              if (!body.target_lang) {
                return new Response(
                  JSON.stringify({
                    error: "Bad request: 请选择目标语言",
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }

              const result = await qwenService.translate(body);
              return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" },
              });
            } catch (error) {
              return new Response(
                JSON.stringify({
                  error: "Bad request: " + (error instanceof Error ? error.message : String(error)),
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          });
        }

        if (url.pathname === "/v1/chat/completions") {
          return authMiddleware.middleware(req, async (req) => {
            try {
              const body = await req.json();
              if (!body.messages || body.messages.length === 0) {
                return new Response(
                  JSON.stringify({
                    error: "Bad request: messages is required",
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }

              const result = await qwenService.chatComplete(body);
              return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" },
              });
            } catch (error) {
              return new Response(
                JSON.stringify({
                  error: "Bad request: " + (error instanceof Error ? error.message : String(error)),
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              );
            }
          });
        }

        return new Response("Not Found", { status: 404 });
      } catch (error) {
        console.error(error);
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    });
  };

  return handler(request);
};
