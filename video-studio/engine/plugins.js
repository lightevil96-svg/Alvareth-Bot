const registry = new Map();

function validName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(value);
}

export function registerVideoPlugin(plugin) {
  if (!plugin || !validName(plugin.name)) throw new Error("Plugin video harus memiliki nama yang valid.");
  if (registry.has(plugin.name)) return false;
  const normalized = {
    name: plugin.name,
    sceneRenderers: Object.freeze({ ...(plugin.sceneRenderers || {}) }),
    backgroundEffectRenderers: Object.freeze({ ...(plugin.backgroundEffectRenderers || {}) }),
    timelineTransforms: Array.isArray(plugin.timelineTransforms) ? plugin.timelineTransforms.slice(0, 12) : []
  };
  for (const renderer of Object.values(normalized.sceneRenderers)) {
    if (typeof renderer !== "function") throw new Error("Scene renderer plugin harus berupa fungsi komponen.");
  }
  for (const renderer of Object.values(normalized.backgroundEffectRenderers)) {
    if (typeof renderer !== "function") throw new Error("Background renderer plugin harus berupa fungsi komponen.");
  }
  if (normalized.timelineTransforms.some(transform => typeof transform !== "function")) {
    throw new Error("Timeline transform plugin harus berupa fungsi.");
  }
  registry.set(plugin.name, Object.freeze(normalized));
  return true;
}

export function unregisterVideoPlugin(name) {
  return registry.delete(name);
}

export function getSceneRenderer(type) {
  for (const plugin of registry.values()) {
    if (plugin.sceneRenderers[type]) return plugin.sceneRenderers[type];
  }
  return null;
}

export function getBackgroundEffectRenderer(type) {
  for (const plugin of registry.values()) {
    if (plugin.backgroundEffectRenderers[type]) return plugin.backgroundEffectRenderers[type];
  }
  return null;
}

export function applyTimelineTransforms(timeline) {
  let current = Array.isArray(timeline) ? timeline.slice() : [];
  for (const plugin of registry.values()) {
    for (const transform of plugin.timelineTransforms) {
      const next = transform(current.slice());
      if (!Array.isArray(next)) throw new Error("Plugin " + plugin.name + " mengembalikan timeline yang tidak valid.");
      current = next;
    }
  }
  return current;
}

export function listVideoPlugins() {
  return Array.from(registry.keys());
}
