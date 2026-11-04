const RATIOS = Object.freeze({
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 }
})
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function validateVideoProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Data proyek harus berupa objek.')
  const title = String(input.title || 'Video LightJurnal').trim().slice(0, 100)
  const mode = input.mode === 'professional' ? 'professional' : 'simple'
  const ratio = Object.hasOwn(RATIOS, input.ratio) ? input.ratio : '9:16'
  const fps = Number(input.fps || 30)
  if (![24, 25, 30].includes(fps)) throw new Error('FPS yang didukung: 24, 25, atau 30.')
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : []
  if (rawScenes.length < 1 || rawScenes.length > 30) throw new Error('Proyek harus memiliki 1 sampai 30 scene.')
  const scenes = rawScenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object') throw new Error(`Scene ${index + 1} tidak valid.`)
    const text = String(scene.text || '').trim().slice(0, 500)
    if (!text) throw new Error(`Teks scene ${index + 1} tidak boleh kosong.`)
    const duration = Number(scene.duration || 4)
    if (!Number.isFinite(duration) || duration < 1 || duration > 15) throw new Error(`Durasi scene ${index + 1} harus 1–15 detik.`)
    const background = HEX_COLOR.test(String(scene.background || '')) ? scene.background : '#14243a'
    return { text, duration, background }
  })
  const durationSeconds = scenes.reduce((sum, scene) => sum + scene.duration, 0)
  if (durationSeconds > 90) throw new Error('Durasi total proyek maksimal 90 detik untuk tahap awal.')
  const dimensions = RATIOS[ratio]
  return { title, mode, ratio, width: dimensions.width, height: dimensions.height, fps, scenes, durationSeconds, durationInFrames: Math.ceil(durationSeconds * fps) }
}

export function getVideoStudioLimits() {
  return { ratios: Object.keys(RATIOS), fps: [24, 25, 30], maxScenes: 30, maxSceneSeconds: 15, maxDurationSeconds: 90 }
}
