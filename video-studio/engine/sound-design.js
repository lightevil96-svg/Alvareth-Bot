// Every cue is attached to a rendered visual event; no arbitrary free-floating sounds.
export const SFX_SECONDS = Object.freeze({ whoosh: .8, swish: .5, pop: .32, impact: .65, thump: .55, click: .12, chime: .9, sparkle: .7, riser: 1.2 });
export function sceneSoundEvents(scene, fps, transitionFrames = 0) {
  if (scene.soundCue === 'none') return [];
  const events = [];
  const intensity = Math.max(0, Math.min(.35, Number(scene.soundIntensity ?? .25)));
  const add = (kind, cue, frame, gain = 1) => events.push({ kind, cue, frame: Math.max(0, Math.round(frame)), volume: intensity * gain });
  const cue = Object.hasOwn(SFX_SECONDS, scene.soundCue) ? scene.soundCue : null;
  if (cue) add(transitionFrames ? 'transition' : 'title-entry', cue, 0);
  else if (transitionFrames && /wipe|slide|zoom/.test(scene.transition)) add('transition', 'whoosh', 0, .75);
  else if (scene.motion === 'scale-in') add('title-entry', 'pop', 0, .65);
  for (const item of (scene.notifications || [])) add('notification-entry', 'click', (Number(item.delaySeconds) || 0) * fps, .6);
  for (const item of (scene.callouts || [])) add('callout-entry', 'chime', (Number(item.delaySeconds) || 0) * fps, .5);
  // Keep sparse cues; simultaneous overlays share one sound rather than stacking peaks.
  return events.sort((a,b) => a.frame - b.frame).filter((event, index, all) => index === 0 || event.frame - all[index - 1].frame >= fps * .25).slice(0, 6);
}
export function buildSoundClips(videoClips, fps, voiceClips = []) {
  return videoClips.flatMap(clip => sceneSoundEvents(clip.scene, fps, clip.transitionInFrames).map((event, index) => {
    const startFrame = clip.startFrame + event.frame;
    const durationInFrames = Math.min(Math.ceil(SFX_SECONDS[event.cue] * fps), clip.endFrame - startFrame);
    const spoken = voiceClips.some(voice => startFrame < voice.startFrame + voice.durationInFrames && startFrame + durationInFrames > voice.startFrame);
    return { id: 'sfx-' + clip.id + '-' + index, trackId: 'audio-sfx', type: 'audio', role: 'sound-effect',
      cue: event.cue, event: event.kind, startFrame, durationInFrames, volume: event.volume * (spoken ? .5 : 1) };
  }).filter(event => event.durationInFrames >= Math.ceil(SFX_SECONDS[event.cue] * fps))); // no chopped tails
}
