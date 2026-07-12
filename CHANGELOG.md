# Changelog — Weekly Analyzer + Clickable Nutrient Chips

Single file modified: `index.html` (no other files touched — Firebase, auth,
and unrelated features are untouched).

## 1. Weekly Nutrition Analyzer
- New card `#weeklyAnalyzerCard` added directly below "Today's Finding" (dashboard view).
- `computeWeeklyTrends()` — deterministic (no AI call), compares the last 7
  logged days against the previous 7 using existing `computeTotals`,
  `computeNutritionScore`, and `getTarget`. Generates observations for:
  % change vs previous week, consistency (days hitting target), Nutrition
  Score trend, food variety, weekday-vs-weekend saturated fat/sodium, and
  sodium-by-meal-time. Positives are always ordered before negatives.
- `renderWeeklyAnalyzer()` renders the list (or hides the card if there's
  not yet enough history); called from `renderAll()` each render, so it
  always reflects the latest diary data.
- New helpers: `loadRecentDays()`, `dateOffsetStr()`, `weekdayIsWeekend()`, `mealBucketForTime()`.

## 2. Clickable nutrient chips in "Today's Finding"
- `highlightInsightTerm()` now wraps a recognized nutrient name in a
  clickable `<b class="insight-term">` that opens the detail panel.
- New `clickableInsightTagValue()` makes the Limiting/Synergy/Hidden tag
  chips clickable too (splits "X × Y" into two independently clickable terms).
- New `resolveNutrientIdByName()` + `NUTRIENT_NAME_INDEX` map nutrient
  display names back to their `id`.

## 3–8. Dynamic nutrient detail panel (works identically for any nutrient)
`openNutrientDetail(id, fromInsight)` (existing function, extended — same
component reused everywhere it was already called: Nutrients tab, Nutrient
Spectrum modal, and now the Today's Finding chips):
- **What it does**: `NUTRIENT_FACTS` dictionary (curated for the commonly
  asked-about nutrients) with a generic category-based fallback via
  `getNutrientFacts()` for anything not curated — so every nutrient works,
  none are hardcoded into separate code paths.
- **Today's intake / target / % achieved**: existing gauge, unchanged.
- **7-day average & trend**: new "This week" stat block.
- **Food sources**: existing contributor list, now sorted/labeled by each
  food's **share of today's total** for that nutrient (matches the spec's
  "Potato — 31%" style) instead of % of target.
- **Why it was mentioned today**: shown only when opened from a Today's
  Finding chip and only for nutrients that were actually part of that
  cached finding — built from the same cached AI reasoning already stored
  for today (no extra AI call), plus a live data-driven status bullet.
- **Suggested foods**: `getNutrientFoodRecommendations()` — priority order
  is (1) foods the user has previously eaten (`foodLibrary`), (2) saved
  meals, (3) a small curated common-foods fallback (`COMMON_FOOD_SOURCES`).
- **Expected improvement**: `estimateNutrientScoreImprovement()` simulates
  bringing this nutrient to 100% of target and reruns the real
  `computeNutritionScore()` algorithm to report the actual projected score
  delta and a confidence level — not a guess.
- `computeNutritionScore(day, totalsOverride)` gained an optional second
  parameter (defaults to previous behavior) purely to support this simulation.

## Verified
- No changes to Firebase config, auth flow, or any other view/feature.
- Extracted and syntax-checked the full inline script with `node --check` — passes.
- All existing call sites of `openNutrientDetail(id)` still work unchanged
  (the new `fromInsight` parameter is optional and defaults to falsy).
- Weekly Analyzer degrades gracefully (hides itself) when there isn't yet
  enough historical data.
