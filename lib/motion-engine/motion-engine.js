export function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

export function lerp(start, end, amount) {
  return Number(start) + (Number(end) - Number(start)) * clamp(amount);
}

export function easeInOutCubic(value) {
  const t = clamp(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function interpolateValue(start, end, amount) {
  if (typeof start === 'number' && typeof end === 'number') return lerp(start, end, amount);
  if (Array.isArray(start) && Array.isArray(end) && start.length === end.length) {
    return start.map((value, index) => interpolateValue(value, end[index], amount));
  }
  return amount < 0.5 ? start : end;
}

export function sampleKeyframes(frame, keyframes = []) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return {};
  const frames = [...keyframes].sort((a, b) => Number(a.frame) - Number(b.frame));
  if (frames.length === 1 || frame <= Number(frames[0].frame)) return frames[0].value || frames[0].pose || frames[0];
  const last = frames[frames.length - 1];
  if (frame >= Number(last.frame)) return last.value || last.pose || last;
  for (let index = 0; index < frames.length - 1; index++) {
    const left = frames[index];
    const right = frames[index + 1];
    const startFrame = Number(left.frame);
    const endFrame = Number(right.frame);
    if (frame < startFrame || frame > endFrame) continue;
    const raw = endFrame === startFrame ? 1 : (frame - startFrame) / (endFrame - startFrame);
    const easing = String(right.easing || left.easing || 'smooth');
    const amount = easing === 'linear' ? clamp(raw) : easeInOutCubic(raw);
    const a = left.value || left.pose || left;
    const b = right.value || right.pose || right;
    const result = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === 'frame' || key === 'easing' || key === 'value' || key === 'pose') continue;
      result[key] = interpolateValue(a[key], b[key], amount);
    }
    return result;
  }
  return last.value || last.pose || last;
}

export function sampleStoryBeat(frame, beats = []) {
  const beat = beats.find(item => frame >= Number(item.startFrame) && frame <= Number(item.endFrame));
  if (!beat) return { beat: null, progress: 0 };
  const span = Math.max(1, Number(beat.endFrame) - Number(beat.startFrame));
  return { beat, progress: clamp((frame - Number(beat.startFrame)) / span) };
}

export function createWalkPose(frame, fps = 30, options = {}) {
  const cycleSeconds = Math.max(0.25, Number(options.cycleSeconds) || 0.82);
  const amplitude = clamp(options.amplitude ?? 0.52, 0, 1.2);
  const phase = (Number(frame) / Math.max(1, Number(fps) || 30) / cycleSeconds) * Math.PI * 2;
  const swing = Math.sin(phase) * amplitude;
  const lift = Math.max(0, Math.sin(phase * 2)) * 0.018;
  return {
    leftLegPitch: swing,
    rightLegPitch: -swing,
    leftKneeBend: Math.max(0, -Math.sin(phase)) * 0.48,
    rightKneeBend: Math.max(0, Math.sin(phase)) * 0.48,
    leftArmPitch: -swing * 0.62,
    rightArmPitch: swing * 0.62,
    leftElbowBend: 0.12,
    rightElbowBend: 0.12,
    rootY: lift
  };
}

export function blinkAmountAtFrame(frame, options = {}) {
  const fps = Math.max(1, Number(options.fps) || 30);
  const period = Math.max(1, Math.round((Number(options.periodSeconds) || 3.1) * fps));
  const duration = Math.max(1, Math.round(Number(options.durationFrames) || 3));
  const offset = Math.round(Number(options.offsetFrames) || 0);
  const phase = ((Math.floor(frame) + offset) % period + period) % period;
  if (phase >= duration) return 0;
  return Math.sin((phase / duration) * Math.PI);
}

export function speechMouthAmountAtFrame(frame, envelope = []) {
  if (!Array.isArray(envelope) || envelope.length === 0) return 0;
  const index = Math.max(0, Math.min(envelope.length - 1, Math.round(Number(frame) || 0)));
  return clamp(envelope[index]);
}

export function createMotionEngine(options = {}) {
  const fps = Math.max(1, Number(options.fps) || 30);
  const beats = Array.isArray(options.beats) ? options.beats : [];
  return {
    fps,
    beats,
    poseAt(frame, keyframes) { return sampleKeyframes(frame, keyframes); },
    beatAt(frame) { return sampleStoryBeat(frame, beats); },
    walkAt(frame, walkOptions) { return createWalkPose(frame, fps, walkOptions); },
    blinkAt(frame, blinkOptions = {}) { return blinkAmountAtFrame(frame, { ...blinkOptions, fps }); },
    mouthAt(frame, envelope) { return speechMouthAmountAtFrame(frame, envelope); }
  };
}
