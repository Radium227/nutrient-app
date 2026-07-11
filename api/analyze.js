const FIREBASE_WEB_API_KEY = 'AIzaSyA5Jp_4A4hUTTn29_EsgbYxPqdWzomas3M';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const JSON_ONLY_PROMPT = 'Return only a valid JSON object. Do not wrap it in markdown or add any extra text.';
const REQUEST_TIMEOUT_MS = 90000;

function getAnalysisConfig(analysisMode) {
  if (analysisMode === 'diet') {
    return { timeoutMs: 25000, maxTokens: 2048 };
  }
  if (analysisMode === 'image') {
    return { timeoutMs: 40000, maxTokens: 8192 };
  }
  return { timeoutMs: 30000, maxTokens: 4096 };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateText(value, limit = 400) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function stripDataUrlPrefix(value) {
  const text = String(value || '');
  const match = text.match(/^data:([^;]+);base64,(.*)$/s);
  return {
    mimeType: match ? match[1] : null,
    data: match ? match[2] : text,
  };
}

function buildImageDataUrl(imageBase64, imageMime) {
  const payload = stripDataUrlPrefix(imageBase64);
  const mimeType = imageMime || payload.mimeType || 'image/jpeg';
  return `data:${mimeType};base64,${payload.data}`;
}

function normalizeFinishReason(reason) {
  if (!reason) return 'STOP';
  const value = String(reason).toUpperCase();
  if (value === 'LENGTH') return 'MAX_TOKENS';
  return value;
}

function cleanJsonText(text) {
  return String(text || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
}

function validateJsonText(text) {
  const cleaned = cleanJsonText(text);
  if (!cleaned) {
    throw new Error('Empty JSON response');
  }
  JSON.parse(cleaned);
  return cleaned;
}

function extractGeminiText(data) {
  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  return parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('');
}

function extractChatText(data) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    }).join('');
  }
  return '';
}

function responseErrorMessage(providerName, status, bodyText) {
  const parsed = bodyText ? (() => {
    try {
      return JSON.parse(bodyText);
    } catch (e) {
      return null;
    }
  })() : null;
  const message = parsed && (parsed.error?.message || parsed.message || parsed.error) ? (parsed.error?.message || parsed.message || parsed.error) : bodyText;
  return `${providerName} error (${status}): ${truncateText(message || 'Unknown error', 300)}`;
}

async function readResponseError(response, providerName) {
  const bodyText = await response.text().catch(() => '');
  return responseErrorMessage(providerName, response.status, bodyText);
}

async function fetchJson(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function isValidIdToken(idToken) {
  const res = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return !!(data && Array.isArray(data.users) && data.users.length > 0);
}

function buildUserParts(prompt, imageBase64, imageMime) {
  const parts = [{ text: `${prompt}\n\n${JSON_ONLY_PROMPT}` }];
  if (imageBase64) {
    const payload = stripDataUrlPrefix(imageBase64);
    parts.push({
      inlineData: {
        mimeType: imageMime || payload.mimeType || 'image/jpeg',
        data: payload.data,
      },
    });
  }
  return parts;
}

function buildOpenAiMessages(prompt, imageBase64, imageMime) {
  const parts = [{ type: 'text', text: `${prompt}\n\n${JSON_ONLY_PROMPT}` }];
  if (imageBase64) {
    parts.push({
      type: 'image_url',
      image_url: { url: buildImageDataUrl(imageBase64, imageMime) },
    });
  }
  return [
    { role: 'system', content: JSON_ONLY_PROMPT },
    { role: 'user', content: parts },
  ];
}

// Status codes worth retrying: rate limiting and server-side/gateway
// hiccups are temporary by nature and often succeed on a retry a moment
// later. Anything else (bad request, auth, not found, etc.) is a genuine
// failure that retrying won't fix, so those still fall straight through.
const RETRYABLE_GEMINI_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_ATTEMPTS = 3;

async function callGemini(prompt, imageBase64, imageMime, analysisMode) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured');
  }
  const { timeoutMs, maxTokens } = getAnalysisConfig(analysisMode);

  const body = {
    contents: [{ role: 'user', parts: buildUserParts(prompt, imageBase64, imageMime) }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
    },
  };

  let lastError = null;
  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await delay(attempt * 750);
    }

    let response;
    try {
      response = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
    } catch (error) {
      // A network-level failure (timeout/abort, connection reset, DNS
      // hiccup, etc.) is exactly the kind of temporary failure that should
      // be retried before falling back to Groq/OpenRouter — previously this
      // threw immediately and skipped Gemini's retry budget entirely.
      lastError = new Error(`Gemini request failed: ${truncateText(error && error.message ? error.message : error, 200)}`);
      if (attempt < GEMINI_MAX_ATTEMPTS - 1) {
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const data = await response.json().catch(() => null);
      const text = extractGeminiText(data);
      const finishReason = normalizeFinishReason(data && data.candidates && data.candidates[0] && data.candidates[0].finishReason);
      return { text: validateJsonText(text), finishReason, provider: 'Gemini' };
    }

    const message = await readResponseError(response, 'Gemini');
    lastError = new Error(message);

    // Retry any transient/temporary status (rate limiting, server overload,
    // gateway errors) before treating Gemini as having genuinely failed.
    // Previously only 503 retried; 429 and other 5xx statuses threw
    // immediately and fell back to Groq/OpenRouter even though a retry
    // would often have succeeded.
    if (RETRYABLE_GEMINI_STATUS_CODES.has(response.status) && attempt < GEMINI_MAX_ATTEMPTS - 1) {
      continue;
    }
    throw lastError;
  }

  throw lastError || new Error('Gemini request failed');
}

async function callGroq(prompt, imageBase64, imageMime, analysisMode) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Groq API key is not configured');
  }
  const { timeoutMs, maxTokens } = getAnalysisConfig(analysisMode);

  const response = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: buildOpenAiMessages(prompt, imageBase64, imageMime),
      response_format: { type: 'json_object' },
      max_completion_tokens: maxTokens,
      temperature: 0,
      top_p: 1,
      stream: false,
    }),
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Groq'));
  }

  const data = await response.json().catch(() => null);
  const text = extractChatText(data);
  const finishReason = normalizeFinishReason(data && data.choices && data.choices[0] && data.choices[0].finish_reason);
  return { text: validateJsonText(text), finishReason, provider: 'Groq' };
}

async function callOpenRouter(prompt, imageBase64, imageMime, analysisMode) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured');
  }
  const { timeoutMs, maxTokens } = getAnalysisConfig(analysisMode);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (process.env.OPENROUTER_HTTP_REFERER) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
  }
  if (process.env.OPENROUTER_TITLE) {
    headers['X-OpenRouter-Title'] = process.env.OPENROUTER_TITLE;
  }

  const response = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: buildOpenAiMessages(prompt, imageBase64, imageMime),
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      temperature: 0,
      top_p: 1,
      stream: false,
    }),
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'OpenRouter'));
  }

  const data = await response.json().catch(() => null);
  const text = extractChatText(data);
  const finishReason = normalizeFinishReason(data && data.choices && data.choices[0] && data.choices[0].finish_reason);
  return { text: validateJsonText(text), finishReason, provider: 'OpenRouter' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }

  try {
    const ok = await isValidIdToken(idToken);
    if (!ok) {
      res.status(401).json({ error: 'Invalid or expired auth token' });
      return;
    }
  } catch (error) {
    res.status(401).json({ error: 'Could not verify auth token' });
    return;
  }

  const { prompt, imageBase64, imageMime, preferredFallbackOrder, analysisMode } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing prompt' });
    return;
  }

  const fallbackNames = ['Groq', 'OpenRouter'];
  const orderedFallbackNames = Array.isArray(preferredFallbackOrder) && preferredFallbackOrder.length
    ? preferredFallbackOrder.filter((name) => fallbackNames.includes(name)).concat(fallbackNames.filter((name) => !preferredFallbackOrder.includes(name)))
    : fallbackNames;
  const providerRuns = {
    Groq: () => callGroq(prompt, imageBase64, imageMime, analysisMode),
    OpenRouter: () => callOpenRouter(prompt, imageBase64, imageMime, analysisMode),
  };
  const providers = [
    { name: 'Gemini', run: () => callGemini(prompt, imageBase64, imageMime, analysisMode) },
    ...orderedFallbackNames.map((name) => ({ name, run: providerRuns[name] })),
  ];

  const failures = [];

  for (const provider of providers) {
    try {
      const result = await provider.run();
      res.status(200).json(result);
      return;
    } catch (error) {
      failures.push(`${provider.name}: ${truncateText(error && error.message ? error.message : error, 240)}`);
    }
  }

  res.status(502).json({
    error: `All analysis providers failed. ${failures.join(' | ')}`,
  });
};
