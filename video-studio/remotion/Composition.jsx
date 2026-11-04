import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

const MUSIC_FILES = {
  cinematic: "audio/music-cinematic.wav",
  upbeat: "audio/music-upbeat.wav",
  calm: "audio/music-calm.wav"
};
const SFX_FILES = {
  whoosh: "audio/sfx-whoosh.wav",
  pop: "audio/sfx-pop.wav",
  impact: "audio/sfx-impact.wav"
};

const isLightColor = hex => {
  const value = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] > 0.58;
};

const SceneMotif = ({ type, accent, index }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 120], [0, 28], { extrapolateRight: "extend" });
  const rotation = interpolate(frame, [0, 180], [0, 14], { extrapolateRight: "extend" });
  const base = {
    position: "absolute",
    right: "5%",
    top: "15%",
    width: "48%",
    height: "68%",
    opacity: 0.42,
    pointerEvents: "none",
    transform: "translateY(" + drift + "px) rotate(" + rotation + "deg)"
  };
  if (type === "none") return null;
  if (type === "grid") {
    return <div style={{ ...base, backgroundImage: "linear-gradient(" + accent + "33 1px, transparent 1px), linear-gradient(90deg, " + accent + "33 1px, transparent 1px)", backgroundSize: "54px 54px", maskImage: "radial-gradient(ellipse, black 20%, transparent 72%)" }} />;
  }
  if (type === "bars") {
    return <div style={{ ...base, display: "flex", alignItems: "center", justifyContent: "center", gap: "3.5%" }}>
      {Array.from({ length: 7 }).map((_, i) => {
        const height = 24 + Math.abs(Math.sin((frame + i * 19 + index * 11) / 24)) * 62;
        return <div key={i} style={{ width: "8%", height: height + "%", borderRadius: 40, background: accent, opacity: 0.35 + (i % 3) * 0.16 }} />;
      })}
    </div>;
  }
  if (type === "wave") {
    return <svg viewBox="0 0 700 900" style={base} fill="none" aria-hidden="true">
      <path d="M-20 460 C120 100 220 100 350 460 S580 820 720 460" stroke={accent} strokeWidth="28" strokeLinecap="round" opacity=".65" />
      <path d="M-20 560 C120 200 220 200 350 560 S580 920 720 560" stroke={accent} strokeWidth="8" strokeLinecap="round" opacity=".45" />
      <circle cx="350" cy="460" r={170 + Math.sin(frame / 22) * 18} stroke={accent} strokeWidth="3" opacity=".4" />
    </svg>;
  }
  if (type === "ribbon") {
    return <svg viewBox="0 0 700 900" style={base} aria-hidden="true">
      <path d="M80 120 C500 40 610 360 340 470 C80 580 180 800 620 730" stroke={accent} strokeWidth="82" fill="none" strokeLinecap="round" opacity=".38" />
      <path d="M80 120 C500 40 610 360 340 470 C80 580 180 800 620 730" stroke="#ffffff" strokeWidth="2" fill="none" strokeDasharray="12 22" opacity=".55" />
    </svg>;
  }
  if (type === "spark") {
    return <svg viewBox="0 0 700 900" style={base} aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => <g key={i} transform={"translate(" + (100 + (i % 3) * 220) + " " + (120 + Math.floor(i / 3) * 270) + ") rotate(" + (frame / 3 + i * 13) + ")"}>
        <path d="M0 -54 L12 -12 L54 0 L12 12 L0 54 L-12 12 L-54 0 L-12 -12 Z" fill={accent} opacity={0.18 + (i % 3) * 0.08} />
      </g>)}
    </svg>;
  }
  if (type === "orbit") {
    return <svg viewBox="0 0 700 900" style={base} fill="none" aria-hidden="true">
      <ellipse cx="350" cy="450" rx="280" ry="112" stroke={accent} strokeWidth="4" transform={"rotate(" + (frame / 5) + " 350 450)"} opacity=".7" />
      <ellipse cx="350" cy="450" rx="210" ry="270" stroke={accent} strokeWidth="3" transform={"rotate(" + (-frame / 7) + " 350 450)"} opacity=".42" />
      <circle cx="350" cy="450" r="70" fill={accent} opacity=".18" />
      <circle cx={350 + Math.cos(frame / 20) * 245} cy={450 + Math.sin(frame / 20) * 112} r="18" fill={accent} />
    </svg>;
  }
  return <svg viewBox="0 0 700 900" style={base} fill="none" aria-hidden="true">
    <circle cx="350" cy="450" r={220 + Math.sin(frame / 24) * 18} stroke={accent} strokeWidth="3" opacity=".6" />
    <circle cx="350" cy="450" r={145 + Math.cos(frame / 30) * 12} stroke={accent} strokeWidth="20" opacity=".18" />
    <circle cx="350" cy="450" r="72" fill={accent} opacity=".28" />
    <path d="M350 90 V810 M0 450 H700" stroke={accent} strokeWidth="2" opacity=".18" />
  </svg>;
};

const SceneSound = ({ cue }) => {
  const frame = useCurrentFrame();
  const source = SFX_FILES[cue];
  if (!source) return null;
  const volume = interpolate(frame, [0, 3, 18], [0, 0.3, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <Audio src={staticFile(source)} volume={volume} />;
};

const MusicTrack = ({ musicStyle, totalFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const source = MUSIC_FILES[musicStyle];
  if (!source) return null;
  const fadeIn = Math.min(1, frame / Math.max(1, fps * 1.8));
  const fadeOut = Math.min(1, Math.max(0, totalFrames - frame) / Math.max(1, fps * 2.2));
  return <Audio src={staticFile(source)} loop volume={0.18 * Math.min(fadeIn, fadeOut)} />;
};

const Scene = ({ scene, index, total }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const durationFrames = Math.max(1, Math.round(scene.duration * fps));
  const entry = spring({ frame, fps, config: { damping: 22, stiffness: 92, mass: 0.9 } });
  const fade = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = interpolate(frame, [Math.max(0, durationFrames - 12), durationFrames], [1, 0.94], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const motion = scene.motion || "fade-up";
  let x = 0;
  let y = 0;
  let scale = 1;
  if (motion === "fade-up" || motion === "reveal") y = interpolate(entry, [0, 1], [44, 0]);
  if (motion === "slide-left") x = interpolate(entry, [0, 1], [110, 0]);
  if (motion === "slide-right") x = interpolate(entry, [0, 1], [-110, 0]);
  if (motion === "scale-in") scale = interpolate(entry, [0, 1], [0.82, 1]);
  if (motion === "float") y = interpolate(frame, [0, 60], [12, -12], { extrapolateRight: "extend" });
  if (motion === "count-up") scale = interpolate(entry, [0, 1], [0.9, 1]);
  const transition = scene.transition || "fade";
  const clipProgress = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const clipPath = transition === "wipe" ? "inset(0 " + (100 - clipProgress * 100) + "% 0 0)" : "none";
  const transitionX = transition === "slide" ? interpolate(frame, [0, 14], [90, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const transitionScale = transition === "zoom" ? interpolate(frame, [0, 14], [1.09, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const transitionOpacity = transition === "cut" || transition === "wipe" ? 1 : fade;
  const background = scene.background || "#111827";
  const accent = scene.accent || "#68DDB8";
  const lightBackground = isLightColor(background);
  const foreground = lightBackground ? "#1B263B" : "#FFFFFF";
  const layout = scene.layout || "hero";
  const alignLeft = layout === "editorial" || layout === "split";
  const textLength = String(scene.text || "").length;
  const fontScale = height >= 1600 ? 1 : 0.82;
  const baseFontSize = Math.max(42, Math.min(98, 98 - textLength * 0.42)) * fontScale;
  const contentWidth = layout === "split" ? "62%" : layout === "editorial" ? "86%" : "90%";
  const contentStyle = {
    width: contentWidth,
    maxWidth: layout === "split" ? "68%" : "100%",
    textAlign: alignLeft ? "left" : "center",
    opacity: transitionOpacity * exit,
    transform: "translate3d(" + (x + transitionX) + "px," + y + "px,0) scale(" + (scale * transitionScale) + ")",
    clipPath,
    position: "relative",
    zIndex: 2
  };
  return <AbsoluteFill style={{ background: "linear-gradient(135deg, " + background + ", " + accent + "24)", color: foreground, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif" }}>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 78% 24%, " + accent + "30, transparent 54%), linear-gradient(160deg, transparent 55%, rgba(0,0,0,.16))" }} />
    <SceneMotif type={scene.motif || "rings"} accent={accent} index={index} />
    <div style={{ position: "absolute", inset: "8%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: alignLeft ? "flex-start" : "center" }}>
      <div style={contentStyle}>
        {scene.kicker ? <div style={{ color: accent, fontSize: 18 * fontScale, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase", marginBottom: 28 }}>{scene.kicker}</div> : null}
        {layout === "quote" ? <div style={{ color: accent, fontSize: 110 * fontScale, fontWeight: 900, lineHeight: 0.65, marginBottom: 20 }}>“</div> : null}
        {layout === "stat" && scene.highlight ? <div style={{ color: accent, fontSize: 118 * fontScale, fontWeight: 900, lineHeight: 0.98, marginBottom: 18, letterSpacing: -5 }}>{scene.highlight}</div> : null}
        <div style={{ fontSize: baseFontSize, lineHeight: 1.04, fontWeight: 850, letterSpacing: -2.4 * fontScale, whiteSpace: "pre-wrap", overflowWrap: "anywhere", textShadow: lightBackground ? "none" : "0 8px 35px rgba(0,0,0,.22)" }}>{scene.text}</div>
        {scene.highlight && layout !== "stat" ? <div style={{ display: "inline-block", marginTop: 18, padding: "8px 16px", borderRadius: 999, color: foreground, background: accent, fontSize: 22 * fontScale, fontWeight: 800 }}>{scene.highlight}</div> : null}
        {scene.subtext ? <div style={{ marginTop: 26, maxWidth: 850, color: foreground, opacity: 0.82, fontSize: 27 * fontScale, lineHeight: 1.42, fontWeight: 450 }}>{scene.subtext}</div> : null}
        {scene.points && scene.points.length ? <div style={{ display: "grid", gap: 12, marginTop: 28, maxWidth: 820, textAlign: "left" }}>
          {scene.points.map((point, pointIndex) => <div key={pointIndex} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22 * fontScale, fontWeight: 650 }}>
            <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: "50%", background: accent, color: lightBackground ? "#fff" : "#172033", fontSize: 15, flex: "0 0 auto" }}>{pointIndex + 1}</span>
            <span>{point}</span>
          </div>)}
        </div> : null}
        {layout === "outro" && scene.highlight ? <div style={{ marginTop: 34, display: "inline-flex", alignItems: "center", gap: 12, padding: "14px 22px", borderRadius: 999, background: accent, color: lightBackground ? "#fff" : "#172033", fontSize: 21 * fontScale, fontWeight: 850 }}>{scene.highlight} <span>↗</span></div> : null}
      </div>
    </div>
    <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "6%", zIndex: 3, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ height: 4, flex: 1, borderRadius: 10, background: foreground + "35", overflow: "hidden" }}>
        <div style={{ height: "100%", width: ((frame + 1) / durationFrames * 100) + "%", background: accent, borderRadius: 10 }} />
      </div>
      <div style={{ color: foreground, opacity: 0.7, fontSize: 15 * fontScale, fontWeight: 700, letterSpacing: 1 }}>{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</div>
    </div>
    <SceneSound cue={scene.soundCue} />
  </AbsoluteFill>;
};

const VideoComposition = ({ scenes, musicStyle = "cinematic", soundEffects = true }) => {
  const { fps } = useVideoConfig();
  const safeScenes = Array.isArray(scenes) ? scenes : [];
  const totalFrames = safeScenes.reduce((sum, scene) => sum + Math.max(1, Math.round(Number(scene.duration || 4) * fps)), 0);
  let from = 0;
  return <AbsoluteFill style={{ background: "#111827" }}>
    <MusicTrack musicStyle={musicStyle} totalFrames={totalFrames} />
    {safeScenes.map((scene, index) => {
      const start = from;
      const durationInFrames = Math.max(1, Math.round(Number(scene.duration || 4) * fps));
      from += durationInFrames;
      return <Sequence key={scene.id || index} from={start} durationInFrames={durationInFrames}>
        <Scene scene={{ ...scene, soundCue: soundEffects ? scene.soundCue : "none" }} index={index} total={safeScenes.length} />
      </Sequence>;
    })}
  </AbsoluteFill>;
};

export const RemotionRoot = () => <Composition
  id="LightJurnalVideo"
  component={VideoComposition}
  width={1080}
  height={1920}
  fps={30}
  durationInFrames={300}
  defaultProps={{
    scenes: [{ id: "scene-01", text: "Mulai berkarya", duration: 4, background: "#111827", accent: "#68DDB8", layout: "hero", motif: "rings", motion: "fade-up", transition: "fade", soundCue: "none" }],
    musicStyle: "cinematic",
    soundEffects: true
  }}
  calculateMetadata={({ props }) => {
    const fps = Number(props.fps || 30);
    const scenes = Array.isArray(props.scenes) ? props.scenes : [];
    const durationInFrames = scenes.reduce((sum, scene) => sum + Math.max(1, Math.round(Number(scene.duration || 4) * fps)), 0);
    const ratios = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
    const dimensions = ratios[props.ratio || "9:16"] || ratios["9:16"];
    return { width: Number(props.width || dimensions[0]), height: Number(props.height || dimensions[1]), fps, durationInFrames: Math.max(1, durationInFrames) };
  }}
/>;
