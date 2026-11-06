import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, useVideoConfig } from "remotion";

const seeded = index => {
  const value = Math.sin((index + 1) * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const Material = ({ style, accent }) => {
  if (style === "chrome") {
    return <meshStandardMaterial color="#dce7f5" metalness={1} roughness={0.14} />;
  }
  if (style === "clay") {
    return <meshStandardMaterial color={accent} metalness={0} roughness={0.88} />;
  }
  if (style === "neon") {
    return <meshStandardMaterial color={accent} metalness={0.35} roughness={0.28} emissive={accent} emissiveIntensity={0.85} />;
  }
  if (style === "soft") {
    return <meshStandardMaterial color={accent} metalness={0.12} roughness={0.48} />;
  }
  return <meshPhysicalMaterial color={accent} metalness={0.12} roughness={0.12} transparent opacity={0.78} clearcoat={1} clearcoatRoughness={0.08} />;
};

const HeroObject = ({ type, style, accent, frame, scale = 1 }) => {
  const rotation = frame * 0.008;
  const bob = Math.sin(frame * 0.045) * 0.12;
  const pulse = 1 + Math.sin(frame * 0.035) * 0.035;
  const material = <Material style={style} accent={accent} />;

  if (type === "cube") {
    return <mesh position={[0, bob, 0]} rotation={[rotation * 0.7, rotation, rotation * 0.35]} scale={scale * pulse}>
      <boxGeometry args={[1.65, 1.65, 1.65, 2, 2, 2]} />
      {material}
    </mesh>;
  }
  if (type === "torus") {
    return <mesh position={[0, bob, 0]} rotation={[rotation * 0.7, rotation, rotation * 0.35]} scale={scale * pulse}>
      <torusKnotGeometry args={[0.92, 0.25, 160, 24, 2, 3]} />
      {material}
    </mesh>;
  }
  if (type === "rings") {
    return <group position={[0, bob, 0]} rotation={[rotation * 0.6, rotation, rotation * 0.25]} scale={scale * pulse}>
      <mesh rotation={[0.8, 0.2, 0]}><torusGeometry args={[1.05, 0.12, 24, 120]} />{material}</mesh>
      <mesh rotation={[1.55, 0.75, 0]}><torusGeometry args={[0.78, 0.075, 20, 100]}><meshStandardMaterial color="#ffffff" metalness={0.75} roughness={0.22} /></torusGeometry></mesh>
      <mesh rotation={[0.2, 1.25, 0]}><torusGeometry args={[1.28, 0.035, 12, 120]}><meshStandardMaterial color={accent} metalness={0.55} roughness={0.24} emissive={accent} emissiveIntensity={0.25} /></torusGeometry></mesh>
      <mesh><icosahedronGeometry args={[0.46, 2]} />{material}</mesh>
    </group>;
  }
  if (type === "crystal") {
    return <mesh position={[0, bob, 0]} rotation={[rotation * 0.6, rotation, rotation * 0.4]} scale={scale * pulse}>
      <octahedronGeometry args={[1.18, 1]} />
      {material}
    </mesh>;
  }
  if (type === "cluster") {
    return <group position={[0, bob, 0]} rotation={[rotation * 0.5, rotation, rotation * 0.3]} scale={scale * pulse}>
      <mesh><sphereGeometry args={[0.64, 48, 48]} />{material}</mesh>
      <mesh position={[-0.92, 0.56, 0.2]} scale={0.42}><sphereGeometry args={[1, 32, 32]} /><meshStandardMaterial color="#ffffff" metalness={0.5} roughness={0.24} /></mesh>
      <mesh position={[0.88, -0.52, 0.3]} scale={0.28}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color={accent} metalness={0.55} roughness={0.2} emissive={accent} emissiveIntensity={0.25} /></mesh>
      <mesh position={[0.1, 1.05, -0.3]} scale={0.2}><sphereGeometry args={[1, 24, 24]} />{material}</mesh>
    </group>;
  }
  return <mesh position={[0, bob, 0]} rotation={[rotation * 0.4, rotation, rotation * 0.2]} scale={scale * pulse}>
    <sphereGeometry args={[1.05, 64, 64]} />
    {material}
  </mesh>;
};

export const ThreeDScene = ({ scene = {}, accent = "#68DDB8" }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const style = ["glass", "chrome", "clay", "neon", "soft"].includes(scene.threeDStyle) ? scene.threeDStyle : "glass";
  const object = ["orb", "cube", "torus", "rings", "crystal", "cluster"].includes(scene.threeDObject) ? scene.threeDObject : "orb";
  const hasTextColumn = ["editorial", "split"].includes(scene.layout);
  const objectX = hasTextColumn ? (width > height ? 1.55 : 0.62) : 0;
  const objectScale = hasTextColumn ? (width > height ? 1.12 : 0.94) : 1.35;
  const cameraY = Math.sin(frame * 0.012) * 0.08;

  return <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
    <ThreeCanvas
      width={width}
      height={height}
      dpr={1}
      camera={{ position: [0, cameraY, 6.2], fov: 42, near: 0.1, far: 100 }}
      gl={{ alpha: true, antialias: true }}
      style={{ position: "absolute", inset: 0, background: "transparent" }}
    >
      <ambientLight intensity={0.62} />
      <directionalLight position={[4, 6, 5]} intensity={2.1} />
      <pointLight position={[-3, 2, 3]} intensity={2.1} color={accent} />
      <pointLight position={[3, -2, -2]} intensity={1.1} color="#9b8cff" />

      <group position={[objectX, 0, 0]}>
        <HeroObject type={object} style={style} accent={accent} frame={frame} scale={objectScale} />

        <mesh rotation={[1.12, 0.42, frame * 0.002]} scale={objectScale * 1.72}>
          <torusGeometry args={[1, 0.012, 8, 128]} />
          <meshStandardMaterial color={accent} metalness={0.65} roughness={0.28} transparent opacity={0.72} emissive={accent} emissiveIntensity={0.16} />
        </mesh>
        <mesh rotation={[0.48, 1.2, -frame * 0.0015]} scale={objectScale * 1.95}>
          <torusGeometry args={[1, 0.006, 6, 128]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.38} />
        </mesh>

        {Array.from({ length: 18 }, (_, index) => {
          const angle = seeded(index) * Math.PI * 2 + frame * (0.002 + seeded(index + 20) * 0.002);
          const radius = 1.7 + seeded(index + 40) * 0.9;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle * 1.3) * (0.75 + seeded(index + 60) * 0.45);
          const z = -0.55 + seeded(index + 80) * 0.9;
          const size = 0.018 + seeded(index + 100) * 0.035;
          return <mesh key={index} position={[x, y, z]}>
            <sphereGeometry args={[size, 10, 10]} />
            <meshBasicMaterial color={index % 3 === 0 ? "#ffffff" : accent} transparent opacity={0.42 + seeded(index + 120) * 0.42} />
          </mesh>;
        })}
      </group>
    </ThreeCanvas>
  </div>;
};
