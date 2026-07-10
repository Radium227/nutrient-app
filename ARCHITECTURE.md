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
- Lets the app stay fast on mobile while still supporting AI analysis

