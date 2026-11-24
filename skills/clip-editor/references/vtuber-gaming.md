# VTuber, anime-avatar, and gaming footage

## Subject tracking

- Do not assume face-detection models trained on human faces will track Live2D, 3D anime, PNGTuber, or stylised avatars.
- Treat Cutroom face matches as candidates only. Its real-face detector can miss or mis-track animated avatars; never convert `UNKNOWN` or `CANDIDATE` to a verified identity.
- Prefer avatar anchors: the visible head/torso bounding region, avatar window, webcam frame, or a manually reviewed set of keyframes.
- If the avatar moves little, use a stable crop. If the avatar is in a fixed stream layout, crop the full avatar panel and preserve the most informative gestures.
- If the avatar and gameplay are both important, use a split layout or a deliberate sequence of avatar/gameplay punch-ins. Never crop out the game event that explains the reaction.

## Speaker attribution

- Use diarization labels such as S1/S2 as provisional speaker tracks, not real names.
- Match a speaker to a visible avatar only when sync, source layout, or reliable user-provided mapping supports it. Record the evidence.
- When multiple VTubers speak, retain enough visual context to distinguish turns. Use a small speaker label only when it helps viewers.

## Gaming

- Preserve the HUD, score, minimap, crosshair, health, inventory, and in-game text when they explain the event.
- Do not cover the critical game area with subtitles or decorative graphics.
- Prioritize the event timeline: anticipation, action, result, reaction. Do not start only at the kill/win if the setup makes it meaningful.
- Use gameplay crop only when it improves legibility; otherwise use a gameplay-plus-avatar layout.
- Avoid fake kill-feed, fake chat, fabricated viewer counts, or added UI that could be mistaken for actual game state.

## Fan clips and publication risk

A clip with original editing can still contain copyrighted stream audio/video. Do not state that adding subtitles, cropping, crediting, or changing speed makes it automatically safe or monetizable. Follow the creator's clipping policy, licence, or explicit permission; retain attribution when required and keep a rights note in the project. If permission is unclear, prepare a private draft and flag publication for human review.
