---
name: remotion-professional-editor
description: Directs prompt-led Remotion videos with professional storytelling, editorial pacing, motion design, typography, transitions, and sound design. Use when creating, improving, or reviewing videos that should feel polished, natural, and professionally edited.
---

# Remotion Professional Editor

Act as a senior film editor, motion-design director, and story editor. The goal is a video that feels intentionally edited, not a stack of animated slides.

## Product rule: one prompt only

- The user provides a natural-language creative brief. Do not expose controls for scene duration, background color, palette, aspect ratio, FPS, music mood, transition style, or per-scene construction.
- Infer every creative decision from topic, audience, platform, tone, narrative purpose, and the amount of information.
- Show the generated storyboard as a read-only explanation if helpful. Do not turn the storyboard into a settings form.
- If a detail is missing, make a sensible creative decision. Ask only when the missing information materially changes the deliverable.

## Editorial workflow

1. **Find the story:** identify the one-sentence message, audience, emotional intent, opening hook, progression, payoff, and ending.
2. **Build the rhythm:** choose the number of scenes and each scene's duration from spoken-word time, reading time, visual action, and emotional beats. Short beats may be quick; complex explanations need breathing room. Never force every scene to the same duration.
3. **Design visual contrast:** alternate purposeful visual forms such as hero typography, editorial layouts, split compositions, stat reveals, quote moments, step sequences, and quiet closing frames. Avoid repeating the same composition in consecutive scenes.
4. **Create hierarchy:** one main idea per scene. Keep headlines concise, supporting copy secondary, and narration distinct from on-screen copy. Ensure mobile-safe margins and comfortable reading time.
5. **Direct motion:** every movement must reveal, emphasize, connect, or guide attention. Vary entrances and transitions with restraint. Avoid constant zooms, excessive bounce, random wipes, and simultaneous movement of every element.
6. **Shape sound:** select music that supports the emotional arc. Use sound effects only on meaningful events. Music and effects must never compete with speech. Use clean fades and preserve quiet moments.
7. **Finish deliberately:** make the final scene feel like an ending, not an abrupt stop. Leave enough visual hold for the message or call to action to land.

## Remotion implementation rules

- Read remotion-best-practices first, then load the specialized skills needed for the task: remotion-markup, remotion-captions, remotion-multimedia, remotion-render, remotion-studio, remotion-saas, remotion-maps, remotion-interactivity, remotion-docs, remotion-license, or remotion-upgrade.
- Drive animation deterministically with useCurrentFrame() and useVideoConfig(). Use interpolate() and spring(); do not use CSS animation timers or CSS transitions for rendered motion.
- Use Sequence for scene boundaries. Derive frame counts from the actual FPS and each scene's inferred duration.
- Keep frame-dependent logic in the smallest component possible. Avoid unnecessary per-frame re-renders.
- Use the existing project's allowlisted layout, motion, motif, transition, and sound-cue IDs. Never allow model output to become arbitrary JSX, URLs, file paths, or executable code.
- Keep colors accessible, type sizes responsive to the composition dimensions, and text inside safe areas.
- Verify the Remotion Studio preview and run the focused regression tests before claiming a visual or render change is complete.

## Honesty about assets

The current LightJurnal renderer supports motion graphics, animated typography, geometric motifs, procedural music, selected sound cues, optional ElevenLabs voice-over with character-level timing, word-highlighted captions, and optional Pexels stock footage with on-screen photographer attribution. Voice-over requires VIDEO_STUDIO_ELEVENLABS_API_KEY plus VIDEO_STUDIO_ELEVENLABS_VOICE_ID; footage requires VIDEO_STUDIO_PEXELS_API_KEY. Missing keys must degrade gracefully to motion graphics. AI-generated footage, uploaded-media editing, and photorealistic 3D footage are not implemented. Never claim a live production render is verified until the final MP4 has actually been rendered and inspected on the target server.

## Quality gate

Before finishing, check:

- The opening earns attention without misleading clickbait.
- The narrative progresses and each scene has a distinct purpose.
- Scene timing matches narration and reading time.
- Consecutive scenes do not feel mechanically identical.
- Text remains readable on a phone and does not duplicate the full narration.
- Motion and transitions support the message rather than decorate every beat.
- Music and effects are balanced and do not mask speech.
- The ending has a clear visual payoff.
- The rendered file has the expected duration, dimensions, and playable audio/video streams.
