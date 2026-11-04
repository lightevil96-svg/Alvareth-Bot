import React from 'react'
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

const MUSIC_FILES = { cinematic: 'audio/music-cinematic.wav', upbeat: 'audio/music-upbeat.wav', calm: 'audio/music-calm.wav' }
const SFX_FILES = ['audio/sfx-impact.wav', 'audio/sfx-whoosh.wav', 'audio/sfx-pop.wav']

const Scene = ({ scene, title, index, soundEffects }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 110, mass: 0.8 } })
  const opacity = interpolate(frame, [0, 12, 90, 120], [0, 1, 1, 0.82], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const translateY = interpolate(entrance, [0, 1], [48, 0])
  return <AbsoluteFill style={{ background: scene.background, color: '#fff', justifyContent: 'center', alignItems: 'center', padding: '9%', fontFamily: 'Arial, sans-serif' }}>
    {soundEffects && <Audio src={staticFile(SFX_FILES[index % SFX_FILES.length])} volume={0.48} />}
    <div style={{ position: 'absolute', top: '7%', left: '8%', right: '8%', display: 'flex', justifyContent: 'space-between', opacity: 0.72, fontSize: 22, letterSpacing: 3 }}><span>LIGHTJURNAL</span><span>{String(index + 1).padStart(2, '0')}</span></div>
    <div style={{ maxWidth: '100%', textAlign: 'center', opacity, transform: `translateY(${translateY}px)` }}>
      {index === 0 ? <div style={{ fontSize: 27, letterSpacing: 5, opacity: 0.72, marginBottom: 34 }}>{title.toUpperCase()}</div> : null}
      <div style={{ fontSize: 76, lineHeight: 1.12, fontWeight: 800, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textShadow: '0 5px 28px rgba(0,0,0,.22)' }}>{scene.text}</div>
    </div>
    <div style={{ position: 'absolute', bottom: '7%', left: '8%', right: '8%', height: 5, background: 'rgba(255,255,255,.22)', borderRadius: 9 }}><div style={{ height: '100%', width: `${Math.min(100, ((frame + 1) / Math.max(1, scene.duration * fps)) * 100)}%`, background: '#72dfb5', borderRadius: 9 }} /></div>
  </AbsoluteFill>
}

const VideoComposition = ({ title, scenes, musicStyle = 'cinematic', soundEffects = true }) => {
  const { fps } = useVideoConfig()
  let from = 0
  const music = MUSIC_FILES[musicStyle]
  return <AbsoluteFill style={{ background: '#14243a' }}>
    {music && <Audio src={staticFile(music)} loop volume={0.2} />}
    {scenes.map((scene, index) => {
      const start = from
      const durationInFrames = Math.max(1, Math.round(scene.duration * fps))
      from += durationInFrames
      return <Sequence key={`${index}-${start}`} from={start} durationInFrames={durationInFrames}><Scene scene={scene} title={title} index={index} soundEffects={soundEffects} /></Sequence>
    })}
  </AbsoluteFill>
}

export const RemotionRoot = () => <Composition id="LightJurnalVideo" component={VideoComposition} width={1080} height={1920} fps={30} durationInFrames={300}
  defaultProps={{ title: 'LightJurnal', scenes: [{ text: 'Mulai berkarya', duration: 10, background: '#14243a' }], musicStyle: 'cinematic', soundEffects: true }}
  calculateMetadata={({ props }) => {
    const fps = Number(props.fps || 30)
    const scenes = Array.isArray(props.scenes) ? props.scenes : []
    const durationInFrames = scenes.reduce((sum, scene) => sum + Math.max(1, Math.round(Number(scene.duration || 4) * fps)), 0)
    return { width: Number(props.width || 1080), height: Number(props.height || 1920), fps, durationInFrames: Math.max(1, durationInFrames) }
  }}
/>
