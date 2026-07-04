// POST /api/analyze
// Body: { prompt: string, imageBase64?: string, imageMime?: string }
// Auth: requires "Authorization: Bearer <Firebase ID token>" header.
//
// This function is the only thing on the server that knows the Gemini API
// key. The browser never sees it. It also checks that the caller is a
// signed-in user of this app (via Firebase Admin) before spending any of
// your Gemini quota, so a stranger who finds the URL can't rack up usage.

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  initializeApp({
    credential: cert(serviceAccount),
  });
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
    await getAuth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired auth token' });
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
