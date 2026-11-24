# Viral candidate scoring and selection

Use this rubric consistently. It ranks editorial potential; it does not predict views, retention, revenue, or monetization.

## Weighted rubric (100 points)

| Dimension | Maximum | What earns a high score |
|---|---:|---|
| Hook | 20 | Immediate curiosity, a surprising statement, clear conflict, strong visual, or an unanswered question in the opening seconds |
| Payoff | 20 | A clear reveal, punchline, answer, emotional reaction, win/fail, or satisfying resolution |
| Context | 15 | A new viewer can understand who/what/why without the full stream or episode |
| Emotion / energy | 15 | Authentic surprise, humor, tension, excitement, warmth, or a meaningful change in energy |
| Clarity | 10 | Dialogue and action are understandable; little ambiguity or dead air |
| Audio | 10 | Speech/music/effects are clean enough to follow; no essential words lost |
| Visual | 5 | The visual adds information, reaction, movement, or a useful focal point |
| Originality | 5 | The moment feels distinctive rather than generic or repeated |

## Scoring procedure

1. Generate candidate windows from highlight output, scene changes, transcript turns, high-energy events, and human review.
2. For each candidate, inspect at least the lead-in and the payoff. Expand the in-point to include enough setup and the out-point to let the reaction land.
3. Assign each dimension an integer score within its maximum. Add the dimensions; the sum must equal `score`.
4. Record direct evidence: source time range, short transcript excerpt where useful, observed action, and uncertainty.
5. Rank by score, then break ties by context, payoff, and source quality.
6. Remove duplicates and near-duplicates unless the user explicitly wants alternate edits of one moment.

## Practical thresholds

- **85–100:** strong candidate; prioritize for first render.
- **70–84:** viable candidate; render when it adds a different type of moment.
- **55–69:** reserve candidate; use only when the user wants more output or the clip fills a real content gap.
- **0–54:** normally reject; explain the weakness if the user asked for a broad selection.

These thresholds are workflow defaults, not platform benchmarks.

## Clip boundary rules

- Start before the first essential word/action, not at the moment the speaker becomes loud.
- Keep a short natural lead-in and reaction tail; use source audio/video inspection to choose the handles.
- Never remove the context that changes the meaning of a joke, debate, reaction, or answer.
- Avoid clipping plosives, breaths that carry emotion, musical transients, or the last syllable.
- Prefer one complete idea. Split only when two distinct moments are independently understandable.
- If a clip needs a title card or long explanation to make sense, reconsider the candidate or add a concise context caption.

## Editorial integrity

Do not fabricate hooks, quotes, reactions, or stakes. Do not splice dialogue from different times to imply a statement the speaker did not make. Do not remove a qualification in a way that changes meaning. Clearly label a paraphrase as on-screen editorial text, not a spoken quote.
