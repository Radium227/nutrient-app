// POST /api/analyze
// Body: { prompt: string, imageBase64?: string, imageMime?: string }
// Auth: requires "Authorization: Bearer <Firebase ID token>" header.
//
// This function is the only thing on the server that knows the Gemini API
// key. The browser never sees it. It also checks that the caller is a
// signed-in user of this app before spending any of your Gemini quota, so
// a stranger who finds the URL can't rack up usage.
//
// Auth check note: we verify the ID token via Firebase's own REST endpoint
// instead of the firebase-admin SDK. firebase-admin pulls in a package
// (jose v6) that's ESM-only, which breaks on some serverless Node runtimes
// with a "require() of ES Module ... not supported" crash. Calling the
// REST endpoint directly avoids that dependency entirely and needs no
// service-account credentials.

// This is the public Firebase Web API key (same one baked into index.html's
// firebaseConfig) — it's not secret, it just identifies the project.
const FIREBASE_WEB_API_KEY = 'AIzaSyA5Jp_4A4hUTTn29_EsgbYxPqdWzomas3M';

async function isValidIdToken(idToken) {
  const res = await fetch(
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

// If Google renames/retires this model string later, this is the only
// place you need to change it.
const GEMINI_MODEL = 'gemini-3.5-flash';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ---- Verify the caller is actually signed in to this app ----
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
  } catch (e) {
    res.status(401).json({ error: 'Could not verify auth token' });
    return;
  }

  // ---- Validate input ----
  const { prompt, imageBase64, imageMime } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing prompt' });
    return;
  }

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: imageMime || 'image/jpeg', data: imageBase64 } });
  }

  // ---- Call Gemini ----
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      res.status(502).json({ error: `Gemini error (${geminiRes.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const data = await geminiRes.json();
    const candidate = data.candidates && data.candidates[0];
    const text = (candidate && candidate.content && candidate.content.parts || [])
      .map((p) => p.text || '')
      .join('');
    const finishReason = (candidate && candidate.finishReason) || 'STOP';

    res.status(200).json({ text, finishReason });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Server error calling Gemini' });
  }
};
