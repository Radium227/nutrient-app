const FIREBASE_WEB_API_KEY = 'AIzaSyA5Jp_4A4hUTTn29_EsgbYxPqdWzomas3M';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct';
const REQUEST_TIMEOUT_MS = 120000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateText(value, limit = 400) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function stripDataUrlPrefix(value) {
  const text = String(value || '');
  const match = text.match(/^data:([^;]+);base64,(.*)$/s);
  return {
    mimeType: match ? match[1] : null,
    data: match ? match[2] : text,
  };
}

function buildDataUrl(imageBase64, imageMime) {
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
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .join('');
  }
  return '';
}

function responseErrorMessage(providerName, status, bodyText) {
  let parsed = null;
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      parsed = null;
    }
  }
  const message = parsed && (parsed.error?.message || parsed.message || parsed.error)
    ? (parsed.error?.message || parsed.message || parsed.error)
    : bodyText;
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
    return await fetch(url, { ...options, signal: controller.signal });
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

function buildGeminiParts(prompt, imageBase64, imageMime) {
  const parts = [{ text: prompt }];
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

function buildChatMessages(prompt, imageBase64, imageMime) {
  const content = [{ type: 'text', text: prompt }];
  if (imageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: buildDataUrl(imageBase64, imageMime) },
    });
  }
  return [{ role: 'user', content }];
}

async function callGemini(prompt, imageBase64, imageMime) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const requestBody = {
    contents: [{ role: 'user', parts: buildGeminiParts(prompt, imageBase64, imageMime) }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 16384,
    },
  };

  let response;
  try {
    response = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );
  } catch (error) {
    throw new Error(`Gemini request failed: ${truncateText(error && error.message ? error.message : error, 200)}`);
  }

  if (response.ok) {
    const data = await response.json().catch(() => null);
    const text = extractGeminiText(data);
    const finishReason = normalizeFinishReason(data && data.candidates && data.candidates[0] && data.candidates[0].finishReason);
    return { text: validateJsonText(text), finishReason, provider: 'Gemini' };
  }

  throw new Error(await readResponseError(response, 'Gemini'));
}

async function callGroq(prompt, imageBase64, imageMime) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Groq API key is not configured');
  }

  const response = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: buildChatMessages(prompt, imageBase64, imageMime),
      response_format: { type: 'json_object' },
      max_completion_tokens: 16384,
      temperature: 0,
      top_p: 1,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'Groq'));
  }

  const data = await response.json().catch(() => null);
  const text = extractChatText(data);
  const finishReason = normalizeFinishReason(data && data.choices && data.choices[0] && data.choices[0].finish_reason);
  return { text: validateJsonText(text), finishReason, provider: 'Groq' };
}

async function callOpenRouter(prompt, imageBase64, imageMime) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured');
  }

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
      messages: buildChatMessages(prompt, imageBase64, imageMime),
      response_format: { type: 'json_object' },
      max_tokens: 16384,
      temperature: 0,
      top_p: 1,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, 'OpenRouter'));
  }

  const data = await response.json().catch(() => null);
  const text = extractChatText(data);
  const finishReason = normalizeFinishReason(data && data.choices && data.choices[0] && data.choices[0].finish_reason);
  return { text: validateJsonText(text), finishReason, provider: 'OpenRouter' };
}

async function callTextFallback(prompt) {
  const providers = [
    { name: 'Gemini', run: () => callGemini(prompt, null, null) },
    { name: 'Groq', run: () => callGroq(prompt, null, null) },
    { name: 'OpenRouter', run: () => callOpenRouter(prompt, null, null) },
  ];

  const failures = [];
  for (const provider of providers) {
    try {
      return await provider.run();
    } catch (error) {
      failures.push(`${provider.name}: ${truncateText(error && error.message ? error.message : error, 240)}`);
    }
  }

  throw new Error(`All analysis providers failed. ${failures.join(' | ')}`);
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

  const { prompt, imageBase64, imageMime, analysisMode } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing prompt' });
    return;
  }

  try {
    if (analysisMode === 'image' || imageBase64) {
      const result = await callGemini(prompt, imageBase64, imageMime);
      res.status(200).json(result);
      return;
    }

    const result = await callTextFallback(prompt);
    res.status(200).json(result);
  } catch (error) {
    res.status(502).json({
      error: error && error.message ? error.message : 'All analysis providers failed',
    });
  }
};
