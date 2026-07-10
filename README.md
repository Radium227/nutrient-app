# Nutrient app — quick reference

See setup steps as guided in chat. Key files:
- `index.html` — the app (Firebase config already filled in)
- `api/analyze.js` — Gemini backend function
- `firestore.rules` — Firestore security rules (already published)

# Architecture

## High-level structure
The app is a lightweight client/server Firebase app:

1. The browser loads `index.html`.
2. Firebase Auth signs the user in.
3. The client reads and writes data to Firestore.
4. Meal analysis goes through `api/analyze.js`.
5. The client renders all dashboard, diary, nutrients, trends, and settings UI from the same page.

## Main files
- `index.html` - complete frontend, rendering, state management, Firebase client setup, and AI request logic
- `api/analyze.js` - serverless analysis endpoint with provider fallback and auth verification
- `firestore.rules` - access control for user data
- `package.json` - minimal Node metadata for deployment

## Data storage model
User data is stored per UID under `users/{uid}/kv/{key}`.

Typical keys include:
- `day:YYYY-MM-DD` - daily diary data
- `profile` - user profile and target setup
- `targetOverrides` - custom nutrient targets
- `savedMeals` - reusable meal templates
- `foodLibrary` - learned per-gram nutrient profiles
- `waterGoal`, `targetsVersion`, and similar app state keys

## Client-side data flow
### Dashboard
- Loads the active day
- Computes calories, burn, progress, and water
- Displays summary cards and quick actions

### Diary
- Renders food, exercise, and weight entries
- Supports delete, refresh, save meal, and manual nutrient actions

### Nutrients
- Aggregates totals for the current day
- Renders nutrients grouped by category
- Highlights percent-of-target progress

### Trends
- Reads the last 14 days
- Renders weight history
- Renders exercise activity trend lines
- Renders a calorie heatmap for quick scanability

## AI flow
### Meal analysis
- Client builds a prompt from the selected input mode
- Client sends prompt + optional image payload to `/api/analyze`
- Backend verifies Firebase auth token
- Backend tries Gemini first, then Groq, then OpenRouter
- Backend returns structured JSON and the provider used

### Re-checking foods
- The app can refresh an existing food entry using the same AI pipeline
- Library learning is then updated so later logs can reuse better nutrient profiles

## Frontend state patterns
- `dayCache` keeps the current date's data in memory
- `foodLibrary` stores learned nutrient profiles keyed by normalized food name
- `savedMeals` stores reusable meal templates
- `pendingPhotoBase64` and related fields manage the active analysis modal

## Rendering approach
- The UI is mostly generated with template strings
- Small helper functions format bars, cards, badges, and nutrient groups
- Chart.js is only used where a canvas is a better fit; other trends use DOM tiles

## Why this shape works well
- Easy to deploy
- Easy to patch without framework churn
- Keeps Firebase auth and Firestore logic simple

- # Changelog

## 2026-07-10
### Added / changed
- Built a Gemini-first analysis backend with Groq and OpenRouter fallback
- Kept Firebase auth in place and preserved the request/response contract
- Removed the frontend analysis timeout so long calls do not fail early
- Added a provider badge so the UI shows which API answered
- Tightened the meal-analysis prompt to emphasize cooked portions, rice normalization, chutney separation, and complete micronutrient output
- Added saved-meal quantity scaling so reusable meals can be logged locally without another AI call
- Reworked trends visuals to use a compact calorie heatmap and exercise trend line
- Rebuilt the distributable ZIP outputs

### Notes
- The app still lives primarily in `index.html`
- The serverless handler remains `api/analyze.js`
- Future sessions should start by reading `PROJECT_CONTEXT.md` and `ARCHITECTURE.md`

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


- Lets the app stay fast on mobile while still supporting AI analysis

