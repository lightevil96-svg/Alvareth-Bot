import * as THREE from 'three';
import { sampleKeyframes, clamp } from './motion-engine.js';

export function applyCinematicCamera(camera, frame, keyframes = []) {
  if (!camera || !camera.isCamera) throw new Error('Camera Three.js wajib diberikan.');
  const state = sampleKeyframes(frame, keyframes);
  if (Array.isArray(state.position) && state.position.length === 3) {
    camera.position.set(state.position[0], state.position[1], state.position[2]);
  }
  const target = Array.isArray(state.target) && state.target.length === 3
    ? state.target
    : [0, 1, 0];
  camera.lookAt(target[0], target[1], target[2]);
  if (camera.isPerspectiveCamera && Number.isFinite(Number(state.fov))) {
    camera.fov = Number(state.fov);
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  return state;
}

export function fitCameraToSubjects(camera, subjects, options = {}) {
  if (!camera?.isPerspectiveCamera) throw new Error('fitCameraToSubjects membutuhkan PerspectiveCamera.');
  const list = Array.isArray(subjects) ? subjects : [subjects];
  const bounds = new THREE.Box3();
  for (const subject of list) {
    if (!subject) continue;
    subject.updateWorldMatrix(true, true);
    bounds.union(new THREE.Box3().setFromObject(subject));
  }
  if (bounds.isEmpty()) return null;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(0.1, size.length() / 2);
  const margin = Math.max(1, Number(options.margin) || 1.2);
  const verticalFov = THREE.MathUtils.degToRad(camera.getEffectiveFOV());
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingFov = Math.max(0.01, Math.min(verticalFov, horizontalFov));
  const distance = (radius / Math.sin(limitingFov / 2)) * margin;
  const direction = new THREE.Vector3(...(options.direction || [0, 0, 1])).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.01, Number(options.near) || 0.1);
  camera.far = Math.max(100, distance + radius * 5);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { center, radius, distance };
}

export function cameraShakeAtFrame(frame, startFrame, durationFrames = 8, intensity = 0.08) {
  const elapsed = Number(frame) - Number(startFrame);
  const duration = Math.max(1, Number(durationFrames) || 8);
  if (elapsed < 0 || elapsed > duration) return [0, 0, 0];
  const decay = 1 - clamp(elapsed / duration);
  const amount = Number(intensity) * decay;
  return [
    Math.sin(elapsed * 2.7) * amount,
    Math.cos(elapsed * 3.4) * amount * 0.7,
    Math.sin(elapsed * 1.9) * amount * 0.35
  ];
}

export class CameraEngine {
  constructor(camera, keyframes = []) {
    this.camera = camera;
    this.keyframes = keyframes;
  }

  update(frame) {
    return applyCinematicCamera(this.camera, frame, this.keyframes);
  }

  fit(subjects, options) {
    return fitCameraToSubjects(this.camera, subjects, options);
  }
}
