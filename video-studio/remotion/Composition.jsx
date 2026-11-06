import { SFX_SECONDS } from "../engine/sound-design.js";
import { fitTextBlock, normalizeDisplayText } from "./text-layout.js";
import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Loop,
  Composition,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { buildTimelineTracks, calculateMusicVolume } from "../engine/timeline.js";
import { registerVideoPlugin, getSceneRenderer } from "../engine/plugins.js";
import {
  AppMockupScene,
  BackgroundEffects,
  CalloutOverlay,
  DataChartScene,
  DiagramScene,
  FaceBubble,
  KineticTypography,
  NotificationOverlay,
  WaveformScene
} from "./Visuals.jsx";
import { ThreeDScene } from "./ThreeDScene.jsx";

const MUSIC_FILES = {
  cinematic: "audio/music-cinematic.wav",
  upbeat: "audio/music-upbeat.wav",
  calm: "audio/music-calm.wav"
};
const SFX_FILES = Object.fromEntries(Object.keys(SFX_SECONDS).map(cue => [cue, 'audio/sfx-' + cue + '.wav']));

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
  const base = { position: "absolute", right: "5%", top: "15%", width: "48%", height: "68%", opacity: 0.32, pointerEvents: "none", transform: "translateY(" + drift + "px) rotate(" + rotation + "deg)" };
  if (type === "none") return null;
  if (type === "grid") return <div style={{ ...base, backgroundImage: "linear-gradient(" + accent + "33 1px, transparent 1px), linear-gradient(90deg, " + accent + "33 1px, transparent 1px)", backgroundSize: "54px 54px", maskImage: "radial-gradient(ellipse, black 20%, transparent 72%)" }} />;
  if (type === "bars") return <div style={{ ...base, display: "flex", alignItems: "center", justifyContent: "center", gap: "3.5%" }}>
    {Array.from({ length: 7 }).map((_, i) => <div key={i} style={{ width: "8%", height: (24 + Math.abs(Math.sin((frame + i * 19 + index * 11) / 24)) * 62) + "%", borderRadius: 40, background: accent, opacity: 0.35 + (i % 3) * 0.16 }} />)}
  </div>;
  if (type === "wave") return <svg viewBox="0 0 700 900" style={base} fill="none" aria-hidden="true">
    <path d="M-20 460 C120 100 220 100 350 460 S580 820 720 460" stroke={accent} strokeWidth="28" strokeLinecap="round" opacity=".65" />
    <path d="M-20 560 C120 200 220 200 350 560 S580 920 720 560" stroke={accent} strokeWidth="8" strokeLinecap="round" opacity=".45" />
    <circle cx="350" cy="460" r={170 + Math.sin(frame / 22) * 18} stroke={accent} strokeWidth="3" opacity=".4" />
  </svg>;
  if (type === "ribbon") return <svg viewBox="0 0 700 900" style={base} aria-hidden="true">
    <path d="M80 120 C500 40 610 360 340 470 C80 580 180 800 620 730" stroke={accent} strokeWidth="82" fill="none" strokeLinecap="round" opacity=".38" />
    <path d="M80 120 C500 40 610 360 340 470 C80 580 180 800 620 730" stroke="#ffffff" strokeWidth="2" fill="none" strokeDasharray="12 22" opacity=".55" />
  </svg>;
  if (type === "spark") return <svg viewBox="0 0 700 900" style={base} aria-hidden="true">
    {Array.from({ length: 9 }).map((_, i) => <g key={i} transform={"translate(" + (100 + (i % 3) * 220) + " " + (120 + Math.floor(i / 3) * 270) + ") rotate(" + (frame / 3 + i * 13) + ")"}>
      <path d="M0 -54 L12 -12 L54 0 L12 12 L0 54 L-12 12 L-54 0 L-12 -12 Z" fill={accent} opacity={0.18 + (i % 3) * 0.08} />
    </g>)}
  </svg>;
  if (type === "orbit") return <svg viewBox="0 0 700 900" style={base} fill="none" aria-hidden="true">
    <ellipse cx="350" cy="450" rx="280" ry="112" stroke={accent} strokeWidth="4" transform={"rotate(" + (frame / 5) + " 350 450)"} opacity=".7" />
    <ellipse cx="350" cy="450" rx="210" ry="270" stroke={accent} strokeWidth="3" transform={"rotate(" + (-frame / 7) + " 350 450)"} opacity=".42" />
    <circle cx="350" cy="450" r="70" fill={accent} opacity=".18" />
    <circle cx={350 + Math.cos(frame / 20) * 245} cy={450 + Math.sin(frame / 20) * 112} r="18" fill={accent} />
  </svg>;
  return <svg viewBox="0 0 700 900" style={base} fill="none" aria-hidden="true">
    <circle cx="350" cy="450" r={220 + Math.sin(frame / 24) * 18} stroke={accent} strokeWidth="3" opacity=".6" />
    <circle cx="350" cy="450" r={145 + Math.cos(frame / 30) * 12} stroke={accent} strokeWidth="20" opacity=".18" />
    <circle cx="350" cy="450" r="72" fill={accent} opacity=".28" />
    <path d="M350 90 V810 M0 450 H700" stroke={accent} strokeWidth="2" opacity=".18" />
  </svg>;
};


const IllustratedScene = ({ scene = {}, accent = "#F5C96B" }) => {
  const frame = useCurrentFrame();
  const description = [scene.visualDescription, scene.text, scene.subtext, scene.purpose].join(" ").toLowerCase();
  const hasMoney = /(uang|invest|modal|dana|rupiah|keuntungan|profit|saham|money|coin|cash|bisnis|usaha)/i.test(description);
  const hasIslamic = /(masjid|islam|muslim|zakat|wakaf|syariah|shalat|sholat|ramadan|sedekah)/i.test(description);
  const hasNature = /(hutan|pohon|gunung|laut|alam|forest|tree|mountain|ocean)/i.test(description);
  const hasTransport = /(sampah|rute|truk|angkut|jalan|kendaraan|mobil|transport|logistik)/i.test(description);
  const hasEducation = /(sekolah|siswa|guru|belajar|kampus|buku|pendidikan|kelas)/i.test(description);
  const hasHospital = /(rumah sakit|dokter|pasien|kesehatan|perawat|klinik|hospital)/i.test(description);
  const hasFood = /(makanan|masakan|kopi|restoran|pangan|kuliner|food|cafe)/i.test(description);
  const drift = Math.sin(frame / 48) * 14;
  const lift = Math.sin(frame / 35) * 9;
  const sceneId = String(scene.id || "illustrated-scene").replace(/[^a-z0-9_-]/gi, "");
  const gradientId = "illustrated-sky-" + sceneId;
  return <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
    <svg viewBox="0 0 1080 1920" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4B36E" stopOpacity=".3" />
          <stop offset="52%" stopColor="#D47C55" stopOpacity=".12" />
          <stop offset="100%" stopColor="#111A33" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1080" height="1280" fill={"url(#" + gradientId + ")"} />
      <circle cx="770" cy={420 + lift} r="235" fill="#F4C66B" opacity=".18" />
      <circle cx="770" cy={420 + lift} r="165" fill="#FFD98A" opacity=".15" />
      <g opacity=".26" stroke="#FFE2A1" strokeWidth="5" strokeLinecap="round">
        <path d="M770 100 V190 M770 650 V740 M450 420 H540 M1000 420 H1080" />
        <path d="M545 195 L600 250 M940 590 L1000 650 M545 645 L600 590" />
      </g>
      <g transform={"translate(0 " + drift + ")"}>
        <path d="M0 1010 Q190 850 390 1005 T790 970 T1080 930 V1320 H0 Z" fill="#293B5C" opacity=".68" />
        <path d="M0 1100 Q220 920 430 1080 T850 1030 T1080 1010 V1370 H0 Z" fill="#172947" opacity=".9" />
        <g fill="#223657" opacity=".94">
          <path d="M65 1110 V820 H225 V1110 Z M255 1110 V730 H430 V1110 Z M455 1110 V875 H600 V1110 Z M825 1110 V790 H1000 V1110 Z" />
        </g>
        <g fill="#F3C66A" opacity=".62">
          <path d="M95 860 H125 V900 H95 Z M150 860 H180 V900 H150 Z M95 935 H125 V975 H95 Z M150 935 H180 V975 H150 Z M290 775 H325 V815 H290 Z M360 775 H395 V815 H360 Z M290 850 H325 V890 H290 Z M360 850 H395 V890 H360 Z M290 925 H325 V965 H290 Z M360 925 H395 V965 H360 Z M490 920 H520 V960 H490 Z M540 920 H570 V960 H540 Z M860 835 H895 V875 H860 Z M925 835 H960 V875 H925 Z M860 910 H895 V950 H860 Z M925 910 H960 V950 H925 Z" />
        </g>
      </g>
      {hasNature ? <g transform={"translate(" + drift + " 0)"}>
        <path d="M90 1110 Q130 870 245 1050 Q335 850 420 1110 Z M680 1110 Q760 820 900 1080 Q1000 900 1080 1110 Z" fill="#34745E" opacity=".82" />
        <path d="M190 1110 V820 M145 900 L190 840 L240 900 M150 970 L190 915 L230 970" stroke="#F2C66D" strokeWidth="24" strokeLinecap="round" fill="none" />
      </g> : null}
      {hasIslamic ? <g transform={"translate(" + (-drift * .4) + " 0)"}>
        <path d="M380 1000 V800 Q540 610 700 800 V1000 Z" fill="#D99B54" stroke="#F7D58A" strokeWidth="12" />
        <path d="M420 800 Q540 610 660 800 Z" fill="#F4C66B" />
        <path d="M360 1000 V760 H410 V1000 M670 1000 V760 H720 V1000" fill="#263B5D" />
        <path d="M385 760 Q385 675 435 760 Z M695 760 Q695 675 745 760 Z" fill="#E9B65F" />
        <path d="M535 620 V540 M520 560 H550" stroke="#F8D98C" strokeWidth="12" strokeLinecap="round" />
        <path d="M490 1000 V880 Q540 820 590 880 V1000" fill="#172947" />
      </g> : null}
      {hasMoney ? <g transform={"translate(" + drift + " " + lift + ")"}>
        <ellipse cx="790" cy="870" rx="105" ry="30" fill="#9C6B34" opacity=".65" />
        <ellipse cx="790" cy="840" rx="105" ry="30" fill="#F1C66A" stroke="#FFF0B9" strokeWidth="9" />
        <ellipse cx="790" cy="785" rx="105" ry="30" fill="#D99B43" stroke="#FFE7A3" strokeWidth="8" />
        <ellipse cx="790" cy="730" rx="105" ry="30" fill="#F4CD72" stroke="#FFF0B9" strokeWidth="8" />
        <circle cx="590" cy="790" r="76" fill="#E6B85B" stroke="#FFE6A0" strokeWidth="12" />
        <text x="590" y="817" textAnchor="middle" fontSize="76" fontWeight="900" fill="#5A3A24">Rp</text>
        <path d="M510 660 L600 600 L690 640 L780 520" fill="none" stroke="#F9D477" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M745 520 H780 V555" fill="none" stroke="#F9D477" strokeWidth="13" strokeLinecap="round" />
      </g> : null}
      {hasTransport ? <g transform={"translate(" + drift + " 0)"}>
        <path d="M180 1010 H830 L920 1120 H100 V1060 Q100 1010 180 1010 Z" fill="#263D5D" stroke="#F3C66A" strokeWidth="10" />
        <rect x="310" y="900" width="420" height="170" rx="28" fill="#D98D4E" stroke="#FFE1A1" strokeWidth="12" />
        <rect x="365" y="930" width="140" height="70" rx="10" fill="#A8D8DF" />
        <rect x="530" y="930" width="140" height="70" rx="10" fill="#A8D8DF" />
        <circle cx="405" cy="1080" r="56" fill="#17243D" stroke="#F4D17B" strokeWidth="15" />
        <circle cx="665" cy="1080" r="56" fill="#17243D" stroke="#F4D17B" strokeWidth="15" />
      </g> : null}
      {hasEducation ? <g transform={"translate(" + (-drift * .5) + " " + lift + ")"}>
        <path d="M330 900 Q450 820 540 900 Q630 820 750 900 V1060 Q630 980 540 1060 Q450 980 330 1060 Z" fill="#E9B95F" stroke="#FFF0B9" strokeWidth="12" />
        <path d="M540 900 V1060" stroke="#8A5C39" strokeWidth="10" />
        <path d="M380 930 Q450 900 500 930 M380 970 Q450 940 500 970 M580 930 Q650 900 700 930 M580 970 Q650 940 700 970" stroke="#6A4B39" strokeWidth="8" strokeLinecap="round" />
      </g> : null}
      {hasHospital ? <g>
        <rect x="330" y="780" width="420" height="300" rx="28" fill="#DCE9E9" stroke="#F4C66B" strokeWidth="12" />
        <path d="M500 850 H580 V920 H650 V1000 H580 V1070 H500 V1000 H430 V920 H500 Z" fill="#D66E59" />
        <path d="M385 780 V720 H695 V780" fill="none" stroke="#F4C66B" strokeWidth="18" strokeLinecap="round" />
      </g> : null}
      {hasFood ? <g transform={"translate(0 " + lift + ")"}>
        <path d="M350 940 Q540 1140 730 940 Z" fill="#F0C56B" stroke="#FFF0B9" strokeWidth="12" />
        <path d="M390 930 Q540 830 690 930" fill="none" stroke="#E8A45A" strokeWidth="18" strokeLinecap="round" />
        <circle cx="470" cy="900" r="26" fill="#5E9B68" /><circle cx="545" cy="875" r="32" fill="#C95E4D" /><circle cx="620" cy="900" r="24" fill="#E5B34F" />
      </g> : null}
      <g transform={"translate(" + (-drift * .35) + " 0)"}>
        <circle cx="410" cy="730" r="56" fill="#D9A178" />
        <path d="M350 730 Q350 655 410 655 Q470 655 470 730 Q440 685 410 685 Q380 685 350 730" fill="#30263B" />
        <path d="M330 1040 V860 Q410 790 490 860 V1040 Z" fill="#E8B45B" stroke="#FFE3A0" strokeWidth="10" />
        <path d="M360 1040 L350 1150 M460 1040 L470 1150" stroke="#263653" strokeWidth="30" strokeLinecap="round" />
        <circle cx="650" cy="760" r="48" fill="#B97F5D" />
        <path d="M600 760 Q600 695 650 695 Q700 695 700 760 Q680 725 650 725 Q620 725 600 760" fill="#22283A" />
        <path d="M585 1060 V880 Q650 820 715 880 V1060 Z" fill="#5B83A5" stroke="#A9D9E4" strokeWidth="9" />
        <path d="M615 1060 L610 1150 M690 1060 L700 1150" stroke="#263653" strokeWidth="28" strokeLinecap="round" />
      </g>
      <g fill="#FFE2A1" opacity=".62">
        {Array.from({ length: 12 }, (_, index) => {
          const x = 90 + index * 82;
          const y = 250 + ((index * 67) % 360);
          const size = 4 + (index % 3) * 2;
          const pulse = .45 + Math.abs(Math.sin(frame / 18 + index)) * .5;
          return <circle key={index} cx={x} cy={y} r={size} opacity={pulse} />;
        })}
      </g>
    </svg>
  </AbsoluteFill>;
};

const SceneSound = ({ cue, volume = 0.55 }) => {
  const frame = useCurrentFrame();
  const source = SFX_FILES[cue];
  if (!source) return null;
  const { fps } = useVideoConfig();
  const end = Math.ceil((SFX_SECONDS[cue] || .8) * fps);
  const envelope = interpolate(frame, [0, 1, Math.max(2, end - 2), end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <Audio src={staticFile(source)} volume={Math.max(0, Math.min(1, volume)) * envelope} />;
};

const MusicTrack = ({ musicStyle, musicTrackSrc, totalFrames, captions, voiceoverTracks, musicVolume = 0.16 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const source = musicTrackSrc;
  if (!source) return null;
  const fadeIn = interpolate(frame, [0, Math.max(1, fps * 1.8)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [Math.max(0, totalFrames - fps * 2.2), totalFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ducked = calculateMusicVolume(frame, fps, captions, voiceoverTracks, musicVolume);
  const volume = ducked * Math.min(fadeIn, fadeOut);
  return <Audio src={staticFile(source)} loop={!musicTrackSrc} volume={volume} />;
};

const VoiceTrack = ({ track }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durationInFrames = track.durationInFrames;
  const fadeIn = Math.max(0, Number(track.fadeInFrames ?? Math.round(.04 * fps)));
  const fadeOut = Math.max(0, Number(track.fadeOutFrames ?? Math.round(.12 * fps)));
  const inGain = fadeIn ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const outGain = fadeOut ? interpolate(frame, [Math.max(0, durationInFrames - fadeOut), durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return <Audio src={staticFile(track.src)} volume={Math.max(0, Math.min(2, Number(track.volume ?? 1))) * Math.min(inGain, outGain)} />;
};

const getCameraTransform = (motion, frame, durationFrames) => {
  const progress = interpolate(frame, [0, Math.max(1, durationFrames)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (motion === "pull-out") return "scale(" + (1.16 - progress * 0.16) + ")";
  if (motion === "pan-left") return "scale(1.12) translateX(" + (-progress * 5) + "%)";
  if (motion === "pan-right") return "scale(1.12) translateX(" + (progress * 5) + "%)";
  if (motion === "tilt-up") return "scale(1.12) translateY(" + (-progress * 5) + "%)";
  if (motion === "tilt-down") return "scale(1.12) translateY(" + (progress * 5) + "%)";
  if (motion === "drift") return "scale(1.1) translate(" + (Math.sin(frame / 48) * 2) + "%," + (Math.cos(frame / 54) * 2) + "%)";
  if (motion === "push-in") return "scale(" + (1.02 + progress * 0.14) + ")";
  return "scale(1.02)";
};

const Scene = ({ scene, index, total, durationFrames, transitionInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const entry = spring({ frame, fps, config: { damping: 22, stiffness: 92, mass: 0.9 } });
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
  const transitionProgress = transitionInFrames > 0
    ? interpolate(frame, [0, transitionInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  let transitionOpacity = 1;
  let transitionX = 0;
  let transitionY = 0;
  let transitionScale = 1;
  let clipPath = "none";
  if (transition === "fade" || transition === "crossfade" || transition === "dissolve") transitionOpacity = transitionProgress;
  if (transition === "wipe" || transition === "wipe-left") clipPath = "inset(0 " + (100 - transitionProgress * 100) + "% 0 0)";
  if (transition === "wipe-right") clipPath = "inset(0 0 0 " + (100 - transitionProgress * 100) + "%)";
  if (transition === "wipe-up") clipPath = "inset(0 0 " + (100 - transitionProgress * 100) + "% 0)";
  if (transition === "wipe-down") clipPath = "inset(" + (100 - transitionProgress * 100) + "% 0 0 0)";
  if (transition === "slide" || transition === "slide-left") transitionX = (1 - transitionProgress) * 8;
  if (transition === "slide-right") transitionX = (transitionProgress - 1) * 8;
  if (transition === "slide-up") transitionY = (1 - transitionProgress) * 8;
  if (transition === "slide-down") transitionY = (transitionProgress - 1) * 8;
  if (transition === "zoom") transitionScale = 1.12 - transitionProgress * 0.12;
  if (transition === "glitch" && transitionProgress < 1) {
    transitionX = Math.sin(frame * 2.8) * (1 - transitionProgress) * 3;
    transitionY = Math.cos(frame * 3.6) * (1 - transitionProgress) * 1.5;
  }
  const background = scene.background || "#111827";
  const accent = scene.accent || "#68DDB8";
  const lightBackground = isLightColor(background);
  const foreground = lightBackground ? "#1B263B" : "#FFFFFF";
  const layout = scene.layout || "hero";
  const visualType = scene.visualType || "editorial";
  const illustrated = visualType === "illustrated";
  const hasSideVisual = ["data-chart", "diagram", "app-mockup", "waveform", "3d"].includes(visualType);
  const alignLeft = !illustrated && (layout === "editorial" || layout === "split" || hasSideVisual);
  const fontScale = height >= 1600 ? 1 : 0.82;
  const contentWidth = illustrated ? "90%" : hasSideVisual ? "47%" : layout === "split" ? "62%" : layout === "editorial" ? "86%" : "90%";
  const contentWidthRatio = illustrated ? 0.9 : hasSideVisual ? 0.47 : layout === "split" ? 0.62 : layout === "editorial" ? 0.86 : 0.9;
  const contentWidthPx = Math.max(180, width * 0.84 * contentWidthRatio);
  const headlineLayout = React.useMemo(() => fitTextBlock(scene.text, contentWidthPx, {
    maxFontSize: 92 * fontScale,
    minFontSize: 28,
    maxLines: hasSideVisual ? 6 : layout === "stat" ? 3 : 5,
    fontWeight: 850,
    letterSpacing: 0
  }), [scene.text, contentWidthPx, fontScale, hasSideVisual, layout]);
  const kickerLayout = React.useMemo(() => fitTextBlock(scene.kicker, contentWidthPx, {
    maxFontSize: 18 * fontScale,
    minFontSize: 12,
    maxLines: 1,
    fontWeight: 800,
    letterSpacing: 1.5
  }), [scene.kicker, contentWidthPx, fontScale]);
  const subtextLayout = React.useMemo(() => fitTextBlock(scene.subtext, contentWidthPx, {
    maxFontSize: 27 * fontScale,
    minFontSize: 17,
    maxLines: 4,
    fontWeight: 450,
    letterSpacing: 0
  }), [scene.subtext, contentWidthPx, fontScale]);
  const highlightLayout = React.useMemo(() => fitTextBlock(scene.highlight, contentWidthPx - 28, {
    maxFontSize: 22 * fontScale,
    minFontSize: 15,
    maxLines: 2,
    fontWeight: 800,
    letterSpacing: 0
  }), [scene.highlight, contentWidthPx, fontScale]);
  const statHighlightLayout = React.useMemo(() => fitTextBlock(scene.highlight, contentWidthPx, {
    maxFontSize: Math.min(118 * fontScale, contentWidthPx * 0.28),
    minFontSize: 32,
    maxLines: 1,
    fontWeight: 900,
    letterSpacing: -2
  }), [scene.highlight, contentWidthPx, fontScale]);
  const pointLayouts = React.useMemo(() => (Array.isArray(scene.points) ? scene.points : []).map(point =>
    fitTextBlock(point, Math.max(120, contentWidthPx - 54), {
      maxFontSize: 22 * fontScale,
      minFontSize: 16,
      maxLines: 2,
      fontWeight: 650,
      letterSpacing: 0
    })
  ), [scene.points, contentWidthPx, fontScale]);
  const contentStyle = {
    width: contentWidth,
    maxWidth: hasSideVisual ? "50%" : layout === "split" ? "68%" : "100%",
    minWidth: 0,
    boxSizing: "border-box",
    textAlign: alignLeft ? "left" : "center",
    opacity: transitionOpacity,
    transform: "translate3d(" + x + "px," + y + "px,0) scale(" + scale + ")",
    position: "relative",
    zIndex: 2
  };
  const Renderer = getSceneRenderer(visualType);
  const specialVisual = Renderer && visualType !== "kinetic" && !(illustrated && scene.footageSrc) ? <Renderer scene={scene} accent={accent} foreground={foreground} /> : null;
  const kinetic = visualType === "kinetic";
  const grade = ({ warm: "saturate(1.08) sepia(.12) contrast(1.05)", cool: "saturate(.88) hue-rotate(8deg) contrast(1.05)", film: "saturate(.82) contrast(1.1) brightness(.96)", vivid: "saturate(1.25) contrast(1.06)", mono: "grayscale(1) contrast(1.08)", neutral: "saturate(.92) contrast(1.04)" })[scene.colorGrade] || "saturate(.92) contrast(1.04)";
  return <AbsoluteFill style={{ background: scene.footageSrc ? "#111827" : "linear-gradient(135deg, " + background + ", " + accent + "24)", color: foreground, overflow: "hidden", fontFamily: "Inter, Arial, sans-serif", opacity: transitionOpacity, clipPath, transform: "translate3d(" + (transitionX * width / 100) + "px," + (transitionY * height / 100) + "px,0) scale(" + transitionScale + ")" }}>
    {scene.footageSrc ? <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Loop durationInFrames={Math.max(1, durationFrames)}>
        <OffthreadVideo src={staticFile(scene.footageSrc)} muted style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: scene.footagePosition || "center", transform: getCameraTransform(scene.cameraMotion, frame, durationFrames), filter: grade }} />
      </Loop>
    </div> : null}
    <AbsoluteFill style={{ background: scene.footageSrc ? "linear-gradient(180deg, rgba(8,12,20,.34), rgba(8,12,20,.78))" : "radial-gradient(ellipse at 78% 24%, " + accent + "30, transparent 54%), linear-gradient(160deg, transparent 55%, rgba(0,0,0,.16))" }} />
    <BackgroundEffects type={scene.backgroundEffect || (scene.footageSrc ? "vignette" : "orbs")} accent={accent} intensity={scene.backgroundEffectIntensity ?? 0.26} />
    <SceneMotif type={scene.motif || "rings"} accent={accent} index={index} />
    {specialVisual}
    <div style={{ position: "absolute", inset: illustrated ? "54% 8% 11%" : "8%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: alignLeft ? "flex-start" : "center" }}>
      <div style={contentStyle}>
        {scene.kicker ? <div style={{ color: accent, fontSize: kickerLayout.fontSize, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 22, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{kickerLayout.text}</div> : null}
        {layout === "quote" ? <div style={{ color: accent, fontSize: 110 * fontScale, fontWeight: 900, lineHeight: 0.65, marginBottom: 20 }}>“</div> : null}
        {layout === "stat" && scene.highlight ? <div style={{ color: accent, fontSize: statHighlightLayout.fontSize, lineHeight: 0.98, fontWeight: 900, marginBottom: 18, letterSpacing: -2 * fontScale, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{statHighlightLayout.text}</div> : null}
        {kinetic
          ? <KineticTypography text={scene.text} highlight={scene.highlight} accent={accent} maxWidthPx={contentWidthPx} maxFontSize={headlineLayout.fontSize} minFontSize={headlineLayout.fontSize} maxLines={headlineLayout.lineCount} />
          : <div style={{ maxWidth: "100%", minWidth: 0, fontSize: headlineLayout.fontSize, lineHeight: 1.08, fontWeight: 850, letterSpacing: 0, whiteSpace: "pre-line", overflowWrap: "anywhere", wordBreak: "normal", textShadow: lightBackground ? "none" : "0 8px 35px rgba(0,0,0,.22)" }}>{headlineLayout.text}</div>}
        {scene.highlight && layout !== "stat" && !kinetic ? <div style={{ display: "inline-block", maxWidth: "100%", boxSizing: "border-box", marginTop: 18, padding: "8px 16px", borderRadius: 16, color: foreground, background: accent, fontSize: highlightLayout.fontSize, lineHeight: 1.2, fontWeight: 800, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{highlightLayout.text}</div> : null}
        {scene.subtext ? <div style={{ marginTop: 22, maxWidth: "100%", minWidth: 0, color: foreground, opacity: 0.84, fontSize: subtextLayout.fontSize, lineHeight: 1.38, fontWeight: 450, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{subtextLayout.text}</div> : null}
        {pointLayouts.length ? <div style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: "100%", textAlign: "left" }}>
          {pointLayouts.map((point, pointIndex) => <div key={pointIndex} style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0, fontSize: point.fontSize, lineHeight: 1.24, fontWeight: 650 }}>
            <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: "50%", background: accent, color: "#172033", fontSize: 14, flex: "0 0 auto" }}>{pointIndex + 1}</span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{point.text}</span>
          </div>)}
        </div> : null}
        {layout === "outro" && scene.highlight ? <div style={{ marginTop: 30, display: "inline-flex", alignItems: "center", gap: 12, maxWidth: "100%", boxSizing: "border-box", padding: "12px 18px", borderRadius: 16, background: accent, color: "#172033", fontSize: highlightLayout.fontSize, lineHeight: 1.2, fontWeight: 850, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{highlightLayout.text} <span>↗</span></div> : null}
      </div>
    </div>
    <FaceBubble src={scene.facecamSrc} position={scene.facecamPosition} durationInFrames={durationFrames} />
    <NotificationOverlay notifications={scene.notifications || []} accent={accent} />
    <CalloutOverlay callouts={scene.callouts || []} accent={accent} />
    <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "6%", zIndex: 13, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ height: 4, flex: 1, borderRadius: 10, background: foreground + "35", overflow: "hidden" }}>
        <div style={{ height: "100%", width: ((frame + 1) / Math.max(1, durationFrames) * 100) + "%", background: accent, borderRadius: 10 }} />
      </div>
      <div style={{ color: foreground, opacity: 0.7, fontSize: 15 * fontScale, fontWeight: 700, letterSpacing: 1 }}>{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</div>
    </div>
    {scene.footageCredit ? <div style={{ position: "absolute", left: "8%", bottom: "2.5%", zIndex: 14, color: foreground, opacity: 0.62, fontSize: 10 * fontScale, fontWeight: 600 }}>{scene.footageCredit === "AI-generated with ComfyUI" ? "AI-generated via ComfyUI" : "Footage · " + scene.footageCredit}</div> : null}
    {scene.transition === "flash" && frame < transitionInFrames ? <AbsoluteFill style={{ background: "#fff", opacity: (1 - transitionProgress) * 0.5 }} /> : null}
    {scene.transition === "dip-to-black" && frame < transitionInFrames ? <AbsoluteFill style={{ background: "#000", opacity: 1 - transitionProgress }} /> : null}
  </AbsoluteFill>;
};

const CaptionOverlay = ({ captions = [], style = "tiktok", position = "bottom" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const time = frame / fps;
  const activeGroup = captions.find(group => time >= group.startSeconds && time <= group.endSeconds);
  if (!activeGroup || !Array.isArray(activeGroup.words)) return null;
  const activeWord = activeGroup.words.findIndex(word => time >= word.startSeconds && time <= word.endSeconds);
  const visibleWords = style === "typewriter" && activeWord >= 0 ? activeGroup.words.slice(0, activeWord + 1) : activeGroup.words;
  const fontSize = Math.max(22, Math.min(40, width * 0.032));
  const cleanSubtitle = style === "subtitle";
  const justifyContent = position === "top" ? "flex-start" : position === "center" ? "center" : "flex-end";
  const paddingTop = position === "top" ? height * 0.12 : 0;
  const paddingBottom = position === "bottom" ? height * 0.145 : 0;
  return <AbsoluteFill style={{ justifyContent, alignItems: "center", paddingBottom, paddingTop, paddingLeft: width * 0.04, paddingRight: width * 0.04, boxSizing: "border-box", pointerEvents: "none", zIndex: 30 }}>
    <div style={{ width: "fit-content", maxWidth: width * 0.88, boxSizing: "border-box", display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "4px 8px", padding: cleanSubtitle ? "9px 14px" : "11px 18px", borderRadius: cleanSubtitle ? 10 : 16, background: cleanSubtitle ? "rgba(0,0,0,.66)" : "rgba(8,12,20,.84)", border: cleanSubtitle ? "none" : "1px solid rgba(255,255,255,.16)", boxShadow: "0 10px 28px rgba(0,0,0,.22)", textAlign: "center" }}>
      {visibleWords.map((word, index) => {
        const captionText = normalizeDisplayText(word.text);
        const active = index === activeWord;
        const wave = style === "wave" ? Math.sin(frame / 3 + index * 0.9) * 5 : 0;
        const pop = style === "pop" && active ? 1.08 : 1;
        const activeBackground = style === "highlight" && active ? "#FFE36E" : "transparent";
        const color = active && ["tiktok", "karaoke", "pop", "wave"].includes(style) ? "#FFE36E" : active && style === "highlight" ? "#172033" : "#FFFFFF";
        return <span key={index} style={{ display: "inline-block", maxWidth: "100%", color, background: activeBackground, borderRadius: 6, padding: activeBackground === "transparent" ? 0 : "2px 6px", fontSize, lineHeight: 1.2, fontWeight: 850, letterSpacing: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", transform: "translateY(" + wave + "px) scale(" + pop + ")", textShadow: "0 2px 12px rgba(0,0,0,.4)" }}>{captionText}</span>;
      })}
    </div>
  </AbsoluteFill>;
};

const VisualSceneRenderer = ({ scene }) => {
  const Renderer = getSceneRenderer(scene.visualType);
  return Renderer ? <Renderer scene={scene} accent={scene.accent} foreground={scene.background && isLightColor(scene.background) ? "#1B263B" : "#FFFFFF"} /> : null;
};

registerVideoPlugin({
  name: "builtin-visuals",
  sceneRenderers: {
    "data-chart": DataChartScene,
    illustrated: IllustratedScene,
    diagram: DiagramScene,
    "app-mockup": AppMockupScene,
    waveform: WaveformScene,
    kinetic: KineticTypography,
    "3d": ThreeDScene
  }
});

const BrandCreditOverlay = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 110, mass: 0.8 } });
  return <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: "5%", pointerEvents: "none", zIndex: 50 }}>
    <div style={{ display: "flex", alignItems: "center", gap: "0.34em", padding: "10px 16px", borderRadius: 999, background: "rgba(5,10,18,.72)", color: "#fff", fontFamily: "Inter, Arial, sans-serif", fontSize: "clamp(16px, 2.1vw, 22px)", fontWeight: 700, letterSpacing: 0, opacity: enter, transform: "translateY(" + ((1 - enter) * 10) + "px)", boxShadow: "0 8px 28px rgba(0,0,0,.24)" }}>
      <span>Dibuat</span>
      <span>oleh</span>
      <strong style={{ fontWeight: 900, letterSpacing: "0.02em" }}>ALVARETHBOT</strong>
    </div>
  </AbsoluteFill>;
};

const VideoComposition = ({
  scenes,
  brandCredit = "",
  musicStyle = "none",
  musicTrackSrc = "",
  musicVolume = 0.16,
  musicBpm = 0,
  soundEffects = true,
  voiceoverTracks = [],
  captions = [],
  captionStyle = "tiktok",
  captionPosition = "bottom"
}) => {
  const { fps } = useVideoConfig();
  const timeline = buildTimelineTracks({ scenes, soundEffects, musicStyle, musicBpm, voiceoverTracks, captions, musicTrackSrc, musicVolume }, fps);
  const safeScenes = Array.isArray(scenes) ? scenes : [];
  const music = timeline.musicClips[0];
  return <AbsoluteFill style={{ background: "#111827" }}>
    {music ? <MusicTrack musicStyle={musicStyle} musicTrackSrc={musicTrackSrc} totalFrames={timeline.durationInFrames} captions={captions} voiceoverTracks={voiceoverTracks} musicVolume={musicVolume} /> : null}
    {timeline.videoClips.map(clip => <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationInFrames} name={clip.id}>
      <Scene scene={{ ...clip.scene, soundCue: soundEffects ? clip.scene.soundCue : "none" }} index={clip.index} total={safeScenes.length} durationFrames={clip.durationInFrames} transitionInFrames={clip.transitionInFrames} />
    </Sequence>)}
    {timeline.voiceClips.map((clip, index) => <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationInFrames} name={clip.id}>
      <VoiceTrack track={clip} />
    </Sequence>)}
    {soundEffects ? timeline.sfxClips.map(clip => <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationInFrames} name={clip.id}>
      <SceneSound cue={clip.cue} volume={clip.volume} />
    </Sequence>) : null}
    <CaptionOverlay captions={captions} style={captionStyle} position={captionPosition} />
    {brandCredit ? <Sequence from={Math.max(0, timeline.durationInFrames - Math.min(timeline.durationInFrames, Math.round(fps * 2.6)))} durationInFrames={Math.min(timeline.durationInFrames, Math.round(fps * 2.6))} name="brand-credit">
      <BrandCreditOverlay />
    </Sequence> : null}
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
    brandCredit: "",
    musicStyle: "none",
    musicTrackSrc: "",
    musicVolume: 0.16,
    musicBpm: 0,
    soundEffects: true,
    voiceoverTracks: [],
    captions: [],
    captionStyle: "tiktok",
    captionPosition: "bottom"
  }}
  calculateMetadata={({ props }) => {
    const fps = Number(props.fps || 30);
    const timeline = buildTimelineTracks(props, fps);
    const ratios = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
    const dimensions = ratios[props.ratio || "9:16"] || ratios["9:16"];
    return { width: Number(props.width || dimensions[0]), height: Number(props.height || dimensions[1]), fps, durationInFrames: Math.max(1, timeline.durationInFrames) };
  }}
/>;
