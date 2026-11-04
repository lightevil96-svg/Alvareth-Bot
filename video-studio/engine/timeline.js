const MUSIC_BPM = Object.freeze({ cinematic: 82, upbeat: 112, calm: 76, none: 0 });
const TRANSITION_BEATS = Object.freeze({
  cut: 0,
  fade: 0.5,
  crossfade: 0.5,
  wipe: 0.5,
  "wipe-left": 0.5,
  "wipe-right": 0.5,
  "wipe-up": 0.5,
  "wipe-down": 0.5,
  slide: 0.5,
  "slide-left": 0.5,
  "slide-right": 0.5,
  "slide-up": 0.5,
  "slide-down": 0.5,
  zoom: 0.5,
  glitch: 0.25,
  dissolve: 0.75,
  flash: 0.25,
  "dip-to-black": 0.5
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function beatsToFrames(beats, bpm, fps) {
  const safeBpm = Number(bpm);
  const safeFps = Number(fps);
  if (!Number.isFinite(safeBpm) || safeBpm <= 0 || !Number.isFinite(safeFps) || safeFps <= 0) return 0;
  return Math.max(0, Math.round(Number(beats) * 60 / safeBpm * safeFps));
}

export function getMusicBpm(style) {
  return MUSIC_BPM[style] || 0;
}

export function getTransitionFrames(transition, durationFrames, fps, bpm) {
  const beats = TRANSITION_BEATS[transition] ?? 0.5;
  if (!beats) return 0;
  const beatFrames = beatsToFrames(beats, bpm, fps);
  const preferred = beatFrames || Math.round(fps * 0.35);
  return clamp(preferred, 0, Math.min(24, Math.floor(durationFrames / 3)));
}

export function buildTimelineTracks(project, fps = project?.fps || 30) {
  const safeFps = Math.max(1, Number(fps) || 30);
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  const bpm = Number(project?.musicBpm) || getMusicBpm(project?.musicStyle);
  let cursor = 0;
  const videoClips = scenes.map((scene, index) => {
    const durationFrames = Math.max(1, Math.round(Number(scene.duration || 4) * safeFps));
    const explicitStart = Number(scene.startSeconds);
    const speechStartFrame = Number.isFinite(explicitStart) && explicitStart >= 0
      ? Math.max(cursor, Math.round(explicitStart * safeFps))
      : cursor;
    const transitionInFrames = index === 0
      ? 0
      : getTransitionFrames(scene.transition || "fade", durationFrames, safeFps, bpm);
    const startFrame = Math.max(0, speechStartFrame - transitionInFrames);
    const endFrame = speechStartFrame + durationFrames;
    cursor = Math.max(cursor, endFrame);
    return {
      id: String(scene.id || "scene-" + (index + 1)),
      trackId: "video-main",
      type: "video",
      index,
      startFrame,
      speechStartFrame,
      endFrame,
      durationInFrames: Math.max(1, endFrame - startFrame),
      transitionInFrames,
      scene
    };
  });

  const voiceClips = (Array.isArray(project?.voiceoverTracks) ? project.voiceoverTracks : []).map((track, index) => ({
    id: "voice-" + index,
    trackId: "audio-voice",
    type: "audio",
    role: "voiceover",
    src: track.src,
    startFrame: Math.max(0, Math.round(Number(track.startSeconds || 0) * safeFps)),
    durationInFrames: Math.max(1, Math.round(Number(track.durationSeconds || 1) * safeFps)),
    volume: clamp(Number(track.volume ?? 1), 0, 2),
    fadeInFrames: Math.max(0, Math.round(Number(track.fadeInSeconds || 0.04) * safeFps)),
    fadeOutFrames: Math.max(0, Math.round(Number(track.fadeOutSeconds || 0.12) * safeFps))
  }));

  const captionClips = (Array.isArray(project?.captions) ? project.captions : []).map((caption, index) => ({
    id: "caption-" + index,
    trackId: "captions-main",
    type: "caption",
    startFrame: Math.max(0, Math.floor(Number(caption.startSeconds || 0) * safeFps)),
    endFrame: Math.max(1, Math.ceil(Number(caption.endSeconds || 0) * safeFps)),
    caption
  }));

  const sfxClips = videoClips.filter(clip => clip.scene.soundCue && clip.scene.soundCue !== "none").map(clip => ({
    id: "sfx-" + clip.id,
    trackId: "audio-sfx",
    type: "audio",
    role: "sound-effect",
    cue: clip.scene.soundCue,
    startFrame: clip.speechStartFrame,
    durationInFrames: Math.max(1, Math.round(safeFps * 0.8)),
    volume: clamp(Number(clip.scene.soundIntensity ?? 0.55), 0, 1)
  }));

  const musicClips = project?.musicTrackSrc ? [{
    id: "music-generated",
    trackId: "audio-music",
    type: "audio",
    role: "music",
    src: project.musicTrackSrc,
    startFrame: 0,
    durationInFrames: cursor,
    volume: clamp(Number(project.musicVolume ?? 0.16), 0, 0.5)
  }] : [{
    id: "music-bed",
    trackId: "audio-music",
    type: "audio",
    role: "music",
    src: project?.musicStyle || "cinematic",
    startFrame: 0,
    durationInFrames: cursor,
    volume: clamp(Number(project.musicVolume ?? 0.16), 0, 0.5)
  }];

  const overlayClips = videoClips.flatMap(clip => {
    const notifications = Array.isArray(clip.scene.notifications) ? clip.scene.notifications : [];
    const callouts = Array.isArray(clip.scene.callouts) ? clip.scene.callouts : [];
    return [
      ...notifications.map((item, index) => ({
        id: "notification-" + clip.id + "-" + index,
        trackId: "overlay-ui",
        type: "overlay",
        role: "notification",
        startFrame: clip.speechStartFrame + Math.round(Number(item.delaySeconds || 0) * safeFps),
        durationInFrames: Math.max(1, Math.round(Number(item.durationSeconds || 2.6) * safeFps)),
        data: item
      })),
      ...callouts.map((item, index) => ({
        id: "callout-" + clip.id + "-" + index,
        trackId: "overlay-ui",
        type: "overlay",
        role: "callout",
        startFrame: clip.speechStartFrame + Math.round(Number(item.delaySeconds || 0) * safeFps),
        durationInFrames: Math.max(1, Math.round(Number(item.durationSeconds || 2) * safeFps)),
        data: item
      }))
    ];
  });

  const endFrame = Math.max(
    1,
    cursor,
    ...videoClips.map(clip => clip.endFrame),
    ...voiceClips.map(clip => clip.startFrame + clip.durationInFrames),
    ...overlayClips.map(clip => clip.startFrame + clip.durationInFrames)
  );

  return {
    fps: safeFps,
    bpm,
    durationInFrames: endFrame,
    tracks: [
      { id: "video-main", type: "video", clips: videoClips },
      { id: "overlay-ui", type: "overlay", clips: overlayClips },
      { id: "audio-voice", type: "audio", clips: voiceClips },
      { id: "audio-music", type: "audio", clips: musicClips },
      { id: "audio-sfx", type: "audio", clips: sfxClips },
      { id: "captions-main", type: "caption", clips: captionClips }
    ],
    videoClips,
    voiceClips,
    musicClips,
    sfxClips,
    captionClips,
    overlayClips
  };
}

export function calculateMusicVolume(frame, fps, captions = [], voiceTracks = [], baseVolume = 0.16) {
  const time = Math.max(0, Number(frame) / Math.max(1, Number(fps) || 30));
  const ranges = Array.isArray(captions) && captions.length
    ? captions.map(item => ({ start: Number(item.startSeconds), end: Number(item.endSeconds) }))
    : voiceTracks.map(item => ({ start: Number(item.startSeconds), end: Number(item.startSeconds) + Number(item.durationSeconds) }));
  if (!ranges.length) return clamp(baseVolume, 0, 0.5);

  let gain = 1;
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) continue;
    if (time >= range.start && time <= range.end) {
      gain = Math.min(gain, 0.28);
    } else if (time >= range.start - 0.22 && time < range.start) {
      const progress = (time - (range.start - 0.22)) / 0.22;
      gain = Math.min(gain, 1 - progress * 0.72);
    } else if (time > range.end && time <= range.end + 0.32) {
      const progress = (time - range.end) / 0.32;
      gain = Math.min(gain, 0.28 + progress * 0.72);
    }
  }
  return clamp(baseVolume, 0, 0.5) * gain;
}
