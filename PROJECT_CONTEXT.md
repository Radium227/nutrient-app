# Project Context

## What this app is
Nutrient is a Firebase-backed AI food diary. The app lets a signed-in user:

- log meals from photo, typed description, manual entry, or saved meals
- see daily calories, macros, water, exercise, weight, and micronutrients
- re-check previously logged foods to fill nutrient gaps
- save meals and scale them later without another AI call

## Current implementation
- Frontend: a single-page app in `index.html`
- Auth: Firebase Google sign-in
- Storage: Firestore per-user key/value docs under `users/{uid}/kv`
- Charts: Chart.js from CDN
- Backend AI endpoint: `api/analyze.js`

## Current AI behavior
- Gemini is always the first provider for meal analysis
- If Gemini fails, the backend falls back to Groq, then OpenRouter
- Gemini retries 503 twice, but switches immediately on 429
- The API returns the first successful JSON response
- The frontend shows which provider handled the result

## Important app rules
- Preserve Firebase authentication logic
- Keep request and response formats stable
- Do not break the saved-meal scaling flow
- Do not remove the nutrient-library learning behavior

## Practical notes
- The app is intentionally conservative about cooked rice and similar plated foods
- The analysis prompt is designed to avoid merging chutney, sauce, gravy, and rice into one item
- Saved meals store a base nutrient profile and are scaled locally
- Trend views are meant to be compact and easy to scan on mobile

