import { webcrypto as crypto } from 'node:crypto';
import { TextDecoder } from 'util';

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
    "EN": "英语",
};

/**
 * 生成随机的 session hash (Node.js version using Web Crypto)
 * @returns {string}
 */
function generateSessionHash() {
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

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
 * 解析 SSE 流
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {Promise<string>}
 */
async function parseEventStream(stream) {
    const decoder = new TextDecoder();
    let result = "";
    let done = false;

    // Node.js ReadableStream is an async iterable
    for await (const chunk of stream) {
        const lines = decoder.decode(chunk, { stream: true }).split("\n");

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const dataStr = line.slice(6);
                if (dataStr === "[DONE]") {
                    done = true;
                    break;

                    
                }
                try {
                    const data = JSON.parse(dataStr);
                    if (data.msg === "unexpected_error") {
                        throw new Error(`Unexpected error: ${data.message || 'Unknown error'}`);
                    }
                    if (data.msg === "process_completed") {
                        if (data.output?.error) {
                            throw new Error(`Process error: ${data.output.error}`);
                        }
                        if (data.output?.data?.[0]) {
                            result = data.output.data[0];
                            done = true;
                            break;
                        }
                    }
                } catch (e) {
                    console.error("Error parsing stream data:", e.message);
                    // 忽略解析错误，继续处理
                }
            }
        }
        if (done) break;
    }

    if (!result) {
        throw new Error("No translation result found in stream");
    }
    return result;
}

/**
 * 核心翻译函数
 * @param {string} text
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
async function translateSingleText(text, sourceLang, targetLang) {
    const qwenSourceLang = mapLanguage(sourceLang);
    const qwenTargetLang = mapLanguage(targetLang);
    const sessionHash = generateSessionHash();

    const headers = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/?t=${Date.now()}&__theme=light&backend_url=/`,
        "Sec-Ch-Ua": `"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"`,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": `"macOS"`,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    };

    // Step 1: Join queue
    const joinUrl = `${BASE_URL}/gradio_api/queue/join?t=${Date.now()}&__theme=light&backend_url=%2F`;
    const joinPayload = {
        data: [text, qwenSourceLang, qwenTargetLang],
        event_data: null,
        fn_index: 2,
        trigger_id: 11,
        data_type: ["textbox", "dropdown", "dropdown"],
        session_hash: sessionHash,
    };

    console.log("Step 1: Joining queue...");
    const joinResp = await fetch(joinUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(joinPayload),
    });

    if (!joinResp.ok) {
        throw new Error(`Failed to join queue: ${joinResp.status} ${joinResp.statusText}`);
    }
    const joinResult = await joinResp.json();
    if (!joinResult.event_id) {
        throw new Error("Failed to get event_id from join queue response");
    }
    console.log("Step 1: Successfully joined queue with event_id:", joinResult.event_id);

    // Step 2: Get translation result from event stream
    const dataUrl = `${BASE_URL}/gradio_api/queue/data?session_hash=${sessionHash}&studio_token=`;
    const dataHeaders = { ...headers, "Accept": "text/event-stream" };

    console.log("Step 2: Fetching translation data...");
    const dataResp = await fetch(dataUrl, { headers: dataHeaders });

    if (!dataResp.ok) {
        throw new Error(`Failed to get translation data: ${dataResp.status} ${dataResp.statusText}`);
    }

    console.log("Step 2: Parsing event stream...");
    return await parseEventStream(dataResp.body);
}


// --- Test Runner ---
(async () => {
    try {
        console.log("--- Starting Qwen Translation Test ---");
        const textToTranslate = "Hello, world! This is a test.";
        const sourceLanguage = "auto";
        const targetLanguage = "ZH"; // 翻译成中文

        console.log(`\nTranslating: "${textToTranslate}"`);
        console.log(`From: ${sourceLanguage}, To: ${targetLanguage}`);

        const result = await translateSingleText(textToTranslate, sourceLanguage, targetLanguage);

        console.log("\n--- Test Result ---");
        console.log("Translation successful!");
        console.log(`Result: ${result}`);
        console.log("-------------------\n");

    } catch (error) {
        console.error("\n--- Test Failed ---");
        console.error(error.message);
        console.error("-------------------\n");
    }
})();