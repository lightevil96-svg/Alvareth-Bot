import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Loop,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile
} from "remotion";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const seeded = index => {
  const value = Math.sin((index + 1) * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export const BackgroundEffects = ({ type = "orbs", accent = "#68DDB8", intensity = 0.3 }) => {
  const frame = useCurrentFrame();
  const opacity = clamp(Number(intensity), 0, 0.65);
  if (type === "none") return null;
  if (type === "grid") return <AbsoluteFill style={{ opacity, backgroundImage: "linear-gradient(" + accent + "28 1px, transparent 1px), linear-gradient(90deg, " + accent + "28 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse at center, black 20%, transparent 78%)", pointerEvents: "none" }} />;
  if (type === "dots") return <AbsoluteFill style={{ opacity: opacity * 0.8, backgroundImage: "radial-gradient(" + accent + "80 1.5px, transparent 1.5px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at center, black 15%, transparent 75%)", pointerEvents: "none" }} />;
  if (type === "vignette") return <AbsoluteFill style={{ opacity: opacity + 0.15, background: "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.78) 100%)", pointerEvents: "none" }} />;
  if (type === "waves") return <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
    <svg viewBox="0 0 1080 1920" preserveAspectRatio="none" width="100%" height="100%">
      {Array.from({ length: 7 }, (_, index) => <path key={index} d={"M-100 " + (520 + index * 125) + " C180 " + (280 + index * 125) + " 300 " + (760 + index * 125) + " 600 " + (520 + index * 125) + " S980 " + (280 + index * 125) + " 1180 " + (520 + index * 125)} fill="none" stroke={accent} strokeWidth={index % 2 ? 3 : 7} opacity={0.24 + index * 0.035} transform={"translate(0 " + Math.sin(frame / 40 + index) * 24 + ")"} />)}
    </svg>
  </AbsoluteFill>;
  if (type === "particles") return <AbsoluteFill style={{ overflow: "hidden", opacity, pointerEvents: "none" }}>
    {Array.from({ length: 34 }, (_, index) => {
      const x = seeded(index * 3) * 100;
      const y = (seeded(index * 5) * 100 + frame * (0.025 + seeded(index) * 0.045)) % 110;
      const size = 2 + seeded(index * 7) * 5;
      return <div key={index} style={{ position: "absolute", left: x + "%", top: y + "%", width: size, height: size, borderRadius: "50%", background: accent, opacity: 0.25 + seeded(index * 9) * 0.6, boxShadow: "0 0 16px " + accent + "70" }} />;
    })}
  </AbsoluteFill>;
  return <AbsoluteFill style={{ opacity, overflow: "hidden", pointerEvents: "none" }}>
    <div style={{ position: "absolute", width: "78%", aspectRatio: "1", borderRadius: "50%", left: "-20%", top: "-12%", background: "radial-gradient(circle, " + accent + "55, transparent 70%)", filter: "blur(60px)", transform: "translateY(" + Math.sin(frame / 48) * 36 + "px)" }} />
    <div style={{ position: "absolute", width: "65%", aspectRatio: "1", borderRadius: "50%", right: "-20%", bottom: "-15%", background: "radial-gradient(circle, " + accent + "38, transparent 70%)", filter: "blur(70px)", transform: "translateY(" + Math.cos(frame / 57) * 42 + "px)" }} />
  </AbsoluteFill>;
};

export const KineticTypography = ({ text = "", highlight = "", accent = "#68DDB8" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const words = String(text).split(/\s+/).filter(Boolean);
  const fontSize = Math.min(width * 0.115, height * 0.09, 116);
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "0.08em 0.22em", textAlign: "center", padding: "0 3%", lineHeight: 1.05 }}>
    {words.map((word, index) => {
      const progress = spring({ frame: Math.max(0, frame - index * 3), fps, config: { damping: 15, stiffness: 155, mass: 0.62 } });
      const emphasized = highlight && word.replace(/[.,!?;:]/g, "").toLowerCase() === String(highlight).toLowerCase();
      return <span key={index} style={{ display: "inline-block", opacity: progress, transform: "translateY(" + (1 - progress) * 42 + "px) scale(" + (0.78 + progress * 0.22) + ")", color: emphasized ? accent : "inherit", fontSize, fontWeight: emphasized ? 950 : 850, letterSpacing: "-0.055em", textShadow: "0 12px 35px rgba(0,0,0,.24)" }}>{word}</span>;
    })}
  </div>;
};

export const DataChartScene = ({ scene = {}, accent = "#68DDB8", foreground = "#fff" }) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const data = Array.isArray(scene.chartData) ? scene.chartData.slice(0, 8) : [];
  if (!data.length) return null;
  const max = Math.max(1, ...data.map(item => Math.max(0, Number(item.value) || 0)));
  return <div style={{ position: "absolute", right: "7%", bottom: "17%", width: "48%", padding: "22px 24px", borderRadius: 24, background: "rgba(8,14,24,.78)", border: "1px solid rgba(255,255,255,.15)", boxShadow: "0 24px 70px rgba(0,0,0,.22)", color: foreground }}>
    {scene.chartTitle ? <div style={{ fontSize: Math.max(14, width * 0.017), fontWeight: 800, marginBottom: 18 }}>{scene.chartTitle}</div> : null}
    <div style={{ display: "grid", gap: 13 }}>
      {data.map((item, index) => {
        const progress = spring({ frame: Math.max(0, frame - index * 5), fps, config: { damping: 20, stiffness: 90 } });
        const value = Math.max(0, Number(item.value) || 0);
        return <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(70px, 28%) 1fr auto", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, opacity: 0.84, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
          <div style={{ height: 12, borderRadius: 99, background: "rgba(255,255,255,.14)", overflow: "hidden" }}>
            <div style={{ width: (value / max * progress * 100) + "%", height: "100%", borderRadius: 99, background: "linear-gradient(90deg," + accent + "," + accent + "99)" }} />
          </div>
          <strong style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString("id-ID")}{scene.chartUnit || ""}</strong>
        </div>;
      })}
    </div>
    {scene.chartSource ? <div style={{ marginTop: 14, fontSize: 10, opacity: 0.62 }}>Sumber: {scene.chartSource}</div> : null}
  </div>;
};

export const DiagramScene = ({ scene = {}, accent = "#68DDB8", foreground = "#fff" }) => {
  const frame = useCurrentFrame();
  const nodes = Array.isArray(scene.diagramNodes) ? scene.diagramNodes.slice(0, 7) : [];
  const edges = Array.isArray(scene.diagramEdges) ? scene.diagramEdges.slice(0, 10) : [];
  if (!nodes.length) return null;
  const positions = nodes.map((node, index) => ({
    ...node,
    x: Number.isFinite(Number(node.x)) ? clamp(Number(node.x), 8, 92) : nodes.length === 1 ? 50 : 10 + index * 80 / (nodes.length - 1),
    y: Number.isFinite(Number(node.y)) ? clamp(Number(node.y), 15, 85) : nodes.length === 1 ? 50 : index % 2 ? 66 : 34
  }));
  const byId = new Map(positions.map(node => [node.id, node]));
  return <div style={{ position: "absolute", left: "7%", right: "7%", bottom: "13%", height: "45%", borderRadius: 24, background: "rgba(7,14,24,.70)", border: "1px solid rgba(255,255,255,.13)", overflow: "hidden" }}>
    <svg viewBox="0 0 1000 500" width="100%" height="100%" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
      {edges.map((edge, index) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const progress = spring({ frame: Math.max(0, frame - index * 5), fps: 30, config: { damping: 24, stiffness: 65 } });
        return <line key={index} x1={from.x * 10} y1={from.y * 5} x2={from.x * 10 + (to.x - from.x) * 10 * progress} y2={from.y * 5 + (to.y - from.y) * 5 * progress} stroke={accent} strokeWidth="4" strokeLinecap="round" opacity=".7" />;
      })}
    </svg>
    {positions.map((node, index) => {
      const progress = spring({ frame: Math.max(0, frame - index * 6), fps: 30, config: { damping: 16, stiffness: 110 } });
      return <div key={node.id} style={{ position: "absolute", left: node.x + "%", top: node.y + "%", transform: "translate(-50%,-50%) scale(" + progress + ")", minWidth: "15%", maxWidth: "27%", padding: "12px 16px", borderRadius: 14, background: "rgba(255,255,255,.12)", border: "1px solid " + accent + "aa", color: foreground, textAlign: "center", fontSize: 14, fontWeight: 800, boxShadow: "0 8px 28px rgba(0,0,0,.22)" }}>{node.label}</div>;
    })}
  </div>;
};

export const AppMockupScene = ({ scene = {}, accent = "#68DDB8" }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const mockup = scene.appMockup || {};
  const rows = Array.isArray(mockup.rows) ? mockup.rows.slice(0, 5) : [];
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, config: { damping: 18, stiffness: 80 } });
  return <div style={{ position: "absolute", right: "8%", bottom: "10%", width: "40%", maxWidth: 470, padding: 12, borderRadius: 30, background: "linear-gradient(145deg,#f7f9fc,#d9e0e9)", boxShadow: "0 32px 90px rgba(0,0,0,.38)", color: "#152236", transform: "translateY(" + (1 - progress) * 50 + "px) rotate(-2deg)" }}>
    <div style={{ height: 18, display: "flex", justifyContent: "center", alignItems: "center" }}><div style={{ width: 64, height: 5, borderRadius: 10, background: "#aab4c1" }} /></div>
    <div style={{ padding: "18px 17px 20px", borderRadius: 20, background: "#fff", minHeight: width * 0.36 }}>
      <div style={{ fontSize: 11, color: "#738196", fontWeight: 800, letterSpacing: 1 }}>PREVIEW APLIKASI</div>
      <div style={{ fontSize: 22, fontWeight: 900, margin: "8px 0 16px" }}>{mockup.title || scene.text}</div>
      {rows.map((row, index) => <div key={index} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: "1px solid #e9edf2", fontSize: 12, fontWeight: 650 }}>
        <span style={{ width: 25, height: 25, borderRadius: 8, background: accent + "28", color: "#24354b", display: "grid", placeItems: "center" }}>{index + 1}</span>
        <span>{row}</span>
      </div>)}
      {mockup.cta ? <div style={{ marginTop: 12, padding: "11px 14px", borderRadius: 12, textAlign: "center", color: "#fff", background: accent, fontWeight: 850, fontSize: 12 }}>{mockup.cta}</div> : null}
    </div>
  </div>;
};

export const WaveformScene = ({ accent = "#68DDB8" }) => {
  const frame = useCurrentFrame();
  const bars = Array.from({ length: 36 }, (_, index) => 14 + Math.abs(Math.sin((frame + index * 11) / 9) * Math.cos(index / 4)) * 78);
  return <div style={{ position: "absolute", left: "10%", right: "10%", bottom: "18%", height: "24%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.65%" }}>
    {bars.map((height, index) => <div key={index} style={{ width: "2%", height: height + "%", borderRadius: 99, background: accent, opacity: 0.38 + (index % 5) * 0.12, boxShadow: "0 0 16px " + accent + "55" }} />)}
  </div>;
};

export const FaceBubble = ({ src, position = "bottom-right", durationInFrames = 90 }) => {
  if (!src) return null;
  const placements = {
    "bottom-right": { right: "7%", bottom: "15%" },
    "bottom-left": { left: "7%", bottom: "15%" },
    "top-right": { right: "7%", top: "12%" },
    "top-left": { left: "7%", top: "12%" }
  };
  return <div style={{ position: "absolute", ...(placements[position] || placements["bottom-right"]), width: "24%", aspectRatio: "1", borderRadius: "50%", overflow: "hidden", border: "5px solid rgba(255,255,255,.9)", boxShadow: "0 12px 36px rgba(0,0,0,.38)", zIndex: 8 }}>
    <Loop durationInFrames={Math.max(1, durationInFrames)}>
      <OffthreadVideo src={staticFile(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </Loop>
  </div>;
};

export const NotificationOverlay = ({ notifications = [], accent = "#68DDB8" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = notifications.find(item => {
    const start = Number(item.delaySeconds || 0) * fps;
    const end = start + Number(item.durationSeconds || 2.6) * fps;
    return frame >= start && frame <= end;
  });
  if (!active) return null;
  const startFrame = Number(active.delaySeconds || 0) * fps;
  const enter = spring({ frame: Math.max(0, frame - startFrame), fps, config: { damping: 18, stiffness: 125 } });
  return <div style={{ position: "absolute", top: "8%", left: "7%", right: "7%", zIndex: 12, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
    <div style={{ width: "min(90%, 650px)", padding: "16px 20px", borderRadius: 18, background: "rgba(248,250,252,.96)", color: "#182333", boxShadow: "0 18px 50px rgba(0,0,0,.28)", borderLeft: "5px solid " + accent, transform: "translateY(" + ((1 - enter) * -38) + "px)", opacity: enter }}>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.58, marginBottom: 5 }}>{active.sender || "NOTIFIKASI"}</div>
      <div style={{ fontSize: 18, fontWeight: 750, lineHeight: 1.35 }}>{active.text}</div>
    </div>
  </div>;
};

export const CalloutOverlay = ({ callouts = [], accent = "#68DDB8" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = callouts.find(item => {
    const start = Number(item.delaySeconds || 0) * fps;
    return frame >= start && frame <= start + Number(item.durationSeconds || 2) * fps;
  });
  if (!active) return null;
  const position = active.position === "top" ? { top: "16%" } : active.position === "center" ? { top: "48%" } : { bottom: "19%" };
  const start = Number(active.delaySeconds || 0) * fps;
  const progress = spring({ frame: Math.max(0, frame - start), fps, config: { damping: 16, stiffness: 140 } });
  return <div style={{ position: "absolute", left: "8%", right: "8%", ...position, zIndex: 10, textAlign: "center", opacity: progress, transform: "scale(" + (0.9 + progress * 0.1) + ")" }}>
    <span style={{ display: "inline-block", padding: "10px 18px", borderRadius: 14, color: "#fff", background: accent, boxShadow: "0 10px 30px rgba(0,0,0,.24)", fontWeight: 900, fontSize: 18 }}>{active.text}</span>
  </div>;
};
