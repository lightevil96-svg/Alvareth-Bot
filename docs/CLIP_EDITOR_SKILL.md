# Alvareth Clip Editor Skill

Alvareth's agent-facing editing skill is located at [`skills/clip-editor/SKILL.md`](../skills/clip-editor/SKILL.md).

It is designed for agents that must turn a long video or a `.analisis` export into selected, edited, and quality-checked clips. The skill includes:
- A consistent 100-point editorial scoring rubric.
- VTuber, avatar, and gameplay-specific framing guidance.
- Subtitle and audio-mix rules that preserve transcript uncertainty.
- A strict clip-plan JSON contract and example.
- A dependency-free Node.js validator and regression tests.
- Render, technical QC, delivery, and rights checklists.

## Validate a generated plan

From the repository root:

```bash
node skills/clip-editor/scripts/validate-clip-plan.mjs skills/clip-editor/templates/clip-plan.example.json
npm run test:skills-clip
```

The validator checks structure, source time ranges, score arithmetic, evidence ranges, output aspect ratio, caption settings, and rights warnings. It does not render a video and does not replace the JSON Schema or human editorial review.

## Important current boundary

The WhatsApp `.analisis` feature still exports analysis artifacts only. It does not call this skill automatically and does not render the final MP4. An AI agent must load this skill, obtain the original source file, prepare and validate `clip-plan.json`, use an available render engine, and run QC. The original video is not included in the analysis ZIP; verify its SHA-256 before reusing analysis timestamps.
