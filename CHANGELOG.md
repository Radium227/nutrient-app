# Changelog

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

