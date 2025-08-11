// Cloudflare Workers - Qwen MT API Adapter
// This version strictly adheres to the logic found in the original Go implementation.

const BASE_URL = "https://qwen-qwen3-mt-demo.ms.show";

// 语言映射表
const LANG_MAP = {
    "自动检测": "auto",
    "自动": "auto",
    "简体中文": "ZH",
    "中文": "ZH",
    "英语": "EN",
    "英文": "EN",
    "auto": "auto",
    "ZH": "ZH",
    "EN": "EN",
};

const QWEN_LANG_MAP = {
    "auto": "自动检测",
    "ZH": "简体中文",
    "TW": "繁体中文",
    "EN": "英语",
};

/**
 * 映射语言代码
 * @param {string} lang
 * @returns {string}
 */
function mapLanguage(lang) {
    const standardLang = LANG_MAP[lang] || lang;
    return QWEN_LANG_MAP[standardLang] || standardLang;
}

/**
 * 核心翻译函数 - 更新为与 qwen-cf-worker.js 一致的逻辑
 * @param {string} text
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
async function translateSingleText(text, sourceLang, targetLang) {
    const qwenSourceLang = mapLanguage(sourceLang);
    const qwenTargetLang = mapLanguage(targetLang);
    // 生成一个12位的随机 session hash
    const sessionHash = Math.random().toString(36).substring(2, 14);

    // --- Step 1: Join the queue ---
    const joinUrl = `${BASE_URL}/gradio_api/queue/join?t=${Date.now()}&__theme=light&backend_url=%2F`;

    const joinPayload = {
        data: [text, qwenSourceLang, qwenTargetLang],
        event_data: null,
        fn_index: 2,
        trigger_id: 11,
        data_type: ["textbox", "dropdown", "dropdown"],
        session_hash: sessionHash,
    };

    const joinHeaders = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/?t=${Date.now()}&__theme=light&backend_url=/`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    };

    const joinResponse = await fetch(joinUrl, {
        method: 'POST',
        headers: joinHeaders,
        body: JSON.stringify(joinPayload),
    });

    if (!joinResponse.ok) {
        const errorText = await joinResponse.text();
        throw new Error(`Failed to join queue: ${joinResponse.status} ${errorText}`);
    }

    const joinResult = await joinResponse.json();
    if (!joinResult.event_id) {
        throw new Error(`Failed to join queue, no event_id in response: ${JSON.stringify(joinResult)}`);
    }


    // --- Step 2: Get translation result from data stream ---
    const dataUrl = `${BASE_URL}/gradio_api/queue/data?session_hash=${sessionHash}&studio_token=`;

    const dataHeaders = {
        "Accept": "text/event-stream",
        "Referer": `${BASE_URL}/?t=${Date.now()}&__theme=light&backend_url=/`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    };

    const dataResponse = await fetch(dataUrl, {
        headers: dataHeaders,
    });

    if (!dataResponse.ok) {
        throw new Error(`Failed to get data stream: ${dataResponse.status}`);
    }

    // 解析 Server-Sent Events (SSE)
    const reader = dataResponse.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        // 将新接收到的数据块追加到缓冲区
        sseBuffer += decoder.decode(value, { stream: true });
        
        // 按行处理缓冲区中的数据
        const lines = sseBuffer.split('\n');
        
        // 保留最后一行，因为它可能是不完整的
        sseBuffer = lines.pop(); 

        for (const line of lines) {
            if (line.trim() === '') continue;
            if (!line.startsWith('data: ')) continue;

            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') {
                break;
            }

            try {
                const eventData = JSON.parse(dataStr);
                if (eventData.msg === 'process_completed') {
                    if (eventData.output && eventData.output.data && eventData.output.data.length > 0) {
                        // 成功找到翻译结果
                        return eventData.output.data[0];
                    }
                } else if (eventData.msg === 'unexpected_error') {
                    throw new Error(`Translation API returned an unexpected error: ${eventData.message || ''}`);
                }
            } catch (e) {
                // 如果解析失败，说明JSON不完整，将当前行数据放回缓冲区头部，等待下一个数据块
                console.log("Could not parse JSON from event stream line, buffering:", dataStr);
                sseBuffer = line + sseBuffer; 
                break; // 停止处理当前批次的行，等待更多数据
            }
        }
    }

    throw new Error("No translation result found in the event stream.");
}

/**
 * 错误响应
 * @param {string} message
 * @param {number} status
 * @returns {Response}
 */
function errorResponse(message, status = 400) {
    return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const auth = request.headers.get("Authorization");

        if (!auth || !auth.startsWith("Bearer ")) {
            return errorResponse("Missing API key", 401);
        }

        if (request.method !== 'POST') {
            return errorResponse('Method Not Allowed', 405);
        }

        try {
            const body = await request.json();

            // 路由处理
            switch (url.pathname) {
                case '/v1/chat/completions':
                    return await handleChatCompletions(body);
                case '/translate':
                    return await handleDeepLXTranslate(body);
                case '/v2/translate':
                case '/api/translate':
                    return await handleDeepLTranslate(body);
                default:
                    return errorResponse('Not Found', 404);
            }
        } catch (e) {
            if (e instanceof SyntaxError) {
                return errorResponse('Invalid JSON', 400);
            }
            console.error("Request failed:", e);
            return errorResponse(e.message || 'Internal Server Error', 500);
        }
    },
};

async function handleChatCompletions(body) {
    const userMessage = body.messages?.findLast?.((m) => m.role === "user")?.content;
    if (!userMessage) {
        return errorResponse("No user message found");
    }
    const model = body.model || 'qwen-mt';
    const sourceLang = body.translation_options?.source_lang || 'auto';
    const targetLang = body.translation_options?.target_lang || 'ZH';

    // Always use the core translation logic, which is stream-based, just like the Go code.
    const translatedText = await translateSingleText(userMessage, sourceLang, targetLang);

    if (body.stream) {
        const stream = new ReadableStream({
            start(controller) {
                const chunkId = `chatcmpl-${Date.now()}`;
                const created = Math.floor(Date.now() / 1000);
                const chunk = {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: created,
                    model: model,
                    choices: [{ index: 0, delta: { content: translatedText }, finish_reason: null }],
                };
                controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);

                const finalChunk = {
                    id: chunkId,
                    object: "chat.completion.chunk",
                    created: created,
                    model: model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                };
                controller.enqueue(`data: ${JSON.stringify(finalChunk)}\n\n`);
                controller.enqueue('data: [DONE]\n\n');
                controller.close();
            }
        });
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            },
        });
    } else {
        const response = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: translatedText,
                },
                finish_reason: "stop",
            }],
            usage: {
                prompt_tokens: userMessage.length,
                completion_tokens: translatedText.length,
                total_tokens: userMessage.length + translatedText.length,
            },
        };
        return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function handleDeepLXTranslate(body) {
    const text = body.text;
    if (!text) return errorResponse("Missing text field");
    const sourceLang = body.source_lang || 'auto';
    const targetLang = body.target_lang || 'ZH';

    const translatedText = await translateSingleText(text, sourceLang, targetLang);

    const response = {
        code: 200,
        id: Date.now(),
        data: translatedText,
        source_lang: mapLanguage(sourceLang),
        target_lang: mapLanguage(targetLang),
    };
    return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
    });
}

async function handleDeepLTranslate(body) {
    const text = body.text;
    if (!Array.isArray(text) || text.length === 0) {
        return errorResponse("text field must be a non-empty array");
    }
    const sourceLang = body.source_lang || 'auto';
    const targetLang = body.target_lang || 'ZH';

    const translations = [];
    for (const t of text) {
        const translatedText = await translateSingleText(t, sourceLang, targetLang);
        translations.push({
            detected_source_language: mapLanguage(sourceLang),
            text: translatedText,
        });
    }

    return new Response(JSON.stringify({ translations }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
