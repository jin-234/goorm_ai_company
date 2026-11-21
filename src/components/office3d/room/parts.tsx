"use client";
/** 사무실 가구와 소품. 외부 모델 없이 기본 도형으로 만든다(맥 앱 원칙). 원점은 바닥 가운데, 앞은 +Z(사람이 쓰는 쪽). */
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, SRGBColorSpace } from "three";
import { drawScreen, type ScreenKind, type TaskLine } from "./screens";
import type { BagKind } from "../person";

export const PALETTE = {
  cream: "#F4ECDB", creamLower: "#EADFC8", wallCap: "#DCCDB2", skirting: "#D3C09D",
  oak: "#DCBE92", oakDeep: "#C6A473", base: "#B99A6E",
  green: "#1F5A45", greenLight: "#2E7459", greenDark: "#173F31",
  deskTop: "#EEDFC4", white: "#F7F3EA", paper: "#FBF8F0", charcoal: "#2C3032", graphite: "#4A4F52",
  steel: "#BDB9B0", brass: "#C9A55E", walnut: "#8A6544", terracotta: "#C87650",
  leaf: "#6AA86A", leafDeep: "#4A8A56", rug: "#DCE1CF", rugLine: "#B9C7AE",
  screenOn: "#DFF2EA", lampWarm: "#FFD9A0",
} as const;

type V3 = [number, number, number];

export function Box({ size, at = [0, 0, 0], color, round = 0, rough = 0.85, metal = 0, shadow = true, children }: {
  size: V3; at?: V3; color: string; round?: number; rough?: number; metal?: number; shadow?: boolean; children?: ReactNode;
}) {
  const material = <meshStandardMaterial color={color} roughness={rough} metalness={metal} />;
  if (round > 0) {
    return (
      <RoundedBox args={size} radius={Math.min(round, ...size.map((s) => s / 2 - 1e-3))} smoothness={3} position={at} castShadow={shadow} receiveShadow>
        {material}
        {children}
      </RoundedBox>
    );
  }
  return (
    <mesh position={at} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
      {material}
      {children}
    </mesh>
  );
}

export function Cylinder({ r, h, at = [0, 0, 0], color, rough = 0.8, metal = 0, top, segments = 24, rotation }: {
  r: number; h: number; at?: V3; color: string; rough?: number; metal?: number; top?: number; segments?: number; rotation?: V3;
}) {
  return (
    <mesh position={at} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[top ?? r, r, h, segments]} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} />
    </mesh>
  );
}

/** 글자 그림(표지판·화면). 브라우저에서만 만든다. */
export function useTextTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, deps: unknown[]) {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    draw(ctx, w, h);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const FONT = `"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 모니터 받침·화면 테두리 없이 화면 그림만 갱신하는 캔버스. 0.8초마다 다시 그리면 타자 치는 것처럼 보인다. */
function useLiveScreen(kind: ScreenKind, seed: number, animate: boolean, tasks: TaskLine[]) {
  const canvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 220;
    return c;
  }, []);
  const texture = useMemo(() => {
    if (!canvas) return null;
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);
  const frame = useRef(0);
  const last = useRef(0);
  const taskKey = tasks.map((t) => `${t.title}:${+t.done}`).join("|");
  const draw = () => {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !texture) return;
    drawScreen(ctx, 320, 220, kind, seed, frame.current, tasks);
    texture.needsUpdate = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(draw, [kind, seed, taskKey, texture]);
  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    if (t - last.current < 0.8) return;
    last.current = t;
    frame.current += 1;
    draw();
  });
  return texture;
}

let glowTexture: CanvasTexture | null = null;
/** 화면 앞 책상에 은은히 번지는 빛(둥근 그라데이션). 모든 모니터가 같이 쓴다. */
function screenGlow() {
  if (glowTexture || typeof document === "undefined") return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(210,240,228,1)");
  g.addColorStop(1, "rgba(210,240,228,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new CanvasTexture(c);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}

/**
 * 모니터. 원점은 받침 바닥, 화면은 +Z. 켜져 있으면 그 사람의 일(코드·메일·일정·설계·과제)이 보이고,
 * 타자 치는 중이면 0.8초마다 줄이 늘고 커서가 깜빡인다. 밤에는 화면 빛이 책상에 번진다.
 */
export function Monitor({ on, kind, seed, typing = false, night, tasks = [] }: {
  on: boolean; kind: ScreenKind; seed: number; typing?: boolean; night: number; tasks?: TaskLine[];
}) {
  const texture = useLiveScreen(kind, seed, on && typing, tasks);
  const glow = screenGlow();
  return (
    <group>
      <Cylinder r={0.11} h={0.015} at={[0, 0.008, 0]} color={PALETTE.charcoal} rough={0.5} top={0.12} />
      <Box size={[0.035, 0.28, 0.03]} at={[0, 0.15, -0.02]} color={PALETTE.charcoal} rough={0.5} />
      <Box size={[0.6, 0.38, 0.035]} at={[0, 0.42, 0]} color={PALETTE.charcoal} round={0.02} rough={0.45} />
      <mesh position={[0, 0.42, 0.0185]}>
        <planeGeometry args={[0.56, 0.34]} />
        {on && texture ? (
          <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.35 + 0.55 * night} roughness={0.4} />
        ) : (
          <meshStandardMaterial color="#25292B" roughness={0.3} />
        )}
      </mesh>
      {on && glow && night > 0.15 && (
        <mesh position={[0, 0.004, 0.24]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.8, 0.5]} />
          <meshBasicMaterial map={glow} transparent opacity={0.45 * night} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

export function Chair({ color = PALETTE.green }: { color?: string }) {
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return <Box key={i} size={[0.04, 0.03, 0.26]} at={[Math.sin(a) * 0.13, 0.05, Math.cos(a) * 0.13]} color={PALETTE.steel} metal={0.4} rough={0.4} shadow={false} />;
      })}
      <Cylinder r={0.025} h={0.36} at={[0, 0.25, 0]} color={PALETTE.steel} metal={0.5} rough={0.35} />
      <Box size={[0.46, 0.08, 0.44]} at={[0, 0.43, 0]} color={color} round={0.035} />
      {/* 등받이는 앉는 사람 뒤(+Z). */}
      <Box size={[0.42, 0.42, 0.07]} at={[0, 0.72, 0.21]} color={color} round={0.035} />
    </group>
  );
}

/** 책상. 원점은 상판 가운데 바닥. 앉는 쪽은 +Z. 상판 윗면 높이 0.76. */
export function Desk({ width, depth, lamp = false, lampOn = 0, drawerLeft = false, children }: {
  width: number; depth: number; lamp?: boolean; lampOn?: number; drawerLeft?: boolean; children?: ReactNode;
}) {
  const top = 0.76;
  return (
    <group>
      <Box size={[width, 0.035, depth]} at={[0, top - 0.0175, 0]} color={PALETTE.deskTop} round={0.012} rough={0.7} />
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Box size={[0.04, top - 0.035, 0.04]} at={[sx * (width / 2 - 0.06), (top - 0.035) / 2, -(depth / 2 - 0.06)]} color={PALETTE.white} rough={0.6} />
          <Box size={[0.04, top - 0.035, 0.04]} at={[sx * (width / 2 - 0.06), (top - 0.035) / 2, depth / 2 - 0.06]} color={PALETTE.white} rough={0.6} />
        </group>
      ))}
      {/* 서랍장 */}
      <Box size={[0.38, 0.55, depth * 0.7]} at={[(drawerLeft ? -1 : 1) * (width / 2 - 0.28), 0.3, -depth * 0.1]} color={PALETTE.white} round={0.02} rough={0.6} />
      {lamp && (
        <group position={[-(width / 2 - 0.18), top, -depth / 2 + 0.16]}>
          <Cylinder r={0.06} h={0.02} at={[0, 0.01, 0]} color={PALETTE.green} />
          <Cylinder r={0.012} h={0.36} at={[0, 0.19, 0]} color={PALETTE.green} />
          <Cylinder r={0.03} top={0.09} h={0.09} at={[0, 0.38, 0.03]} color={PALETTE.green} />
          <mesh position={[0, 0.35, 0.03]}>
            <sphereGeometry args={[0.03, 12, 10]} />
            <meshStandardMaterial color={PALETTE.lampWarm} emissive={PALETTE.lampWarm} emissiveIntensity={lampOn * 3} />
          </mesh>
          {lampOn > 0.05 && <pointLight position={[0, 0.3, 0.05]} intensity={lampOn * 0.9} distance={1.6} decay={2} color={PALETTE.lampWarm} />}
        </group>
      )}
      {children}
    </group>
  );
}

export function Keyboard() {
  return (
    <group>
      <Box size={[0.36, 0.018, 0.12]} at={[0, 0.009, 0]} color={PALETTE.white} round={0.008} rough={0.5} />
      <mesh position={[0, 0.0185, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.33, 0.095]} />
        <meshStandardMaterial color="#DCD6CA" roughness={0.6} />
      </mesh>
    </group>
  );
}

export function Mouse() {
  return (
    <group>
      <Box size={[0.2, 0.004, 0.17]} at={[0, 0.002, 0]} color={PALETTE.greenDark} round={0.002} rough={0.9} shadow={false} />
      <mesh position={[0, 0.016, 0]} scale={[0.55, 0.32, 0.85]} castShadow>
        <sphereGeometry args={[0.05, 16, 12]} />
        <meshStandardMaterial color={PALETTE.white} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** 머그. 원점은 바닥 가운데. 손잡이는 +X. */
export function Mug({ color, coffee = true }: { color: string; coffee?: boolean }) {
  return (
    <group>
      <Cylinder r={0.04} h={0.09} at={[0, 0.045, 0]} color={color} rough={0.35} segments={20} />
      {coffee && (
        <mesh position={[0, 0.082, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.034, 18]} />
          <meshStandardMaterial color="#4B2E22" roughness={0.2} />
        </mesh>
      )}
      <mesh position={[0.045, 0.048, 0]} rotation={[0, 0, 0]} castShadow>
        <torusGeometry args={[0.022, 0.007, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** 의자 옆 바닥에 내려놓은 가방. 사람 쪽 가방(f4)과 같은 색·종류. */
export function DeskBag({ kind, color }: { kind: BagKind; color: string }) {
  if (kind === "backpack") {
    return (
      <group rotation={[-0.18, 0, 0]}>
        <Box size={[0.3, 0.34, 0.15]} at={[0, 0.17, 0]} color={color} round={0.06} />
        <Box size={[0.22, 0.13, 0.05]} at={[0, 0.1, 0.085]} color={color} round={0.03} />
        <mesh position={[0, 0.34, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.04, 0.012, 8, 16, Math.PI]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      </group>
    );
  }
  if (kind === "briefcase") {
    return (
      <group>
        <Box size={[0.38, 0.28, 0.1]} at={[0, 0.14, 0]} color={color} round={0.025} rough={0.55} />
        <mesh position={[0, 0.3, 0]}>
          <torusGeometry args={[0.05, 0.01, 8, 16, Math.PI]} />
          <meshStandardMaterial color={PALETTE.charcoal} roughness={0.5} />
        </mesh>
        <Box size={[0.03, 0.03, 0.105]} at={[-0.1, 0.24, 0]} color={PALETTE.brass} metal={0.6} rough={0.3} shadow={false} />
        <Box size={[0.03, 0.03, 0.105]} at={[0.1, 0.24, 0]} color={PALETTE.brass} metal={0.6} rough={0.3} shadow={false} />
      </group>
    );
  }
  // 토트: 위가 조금 넓은 몸통과 두 손잡이.
  return (
    <group>
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.17, 0.3, 4, 1]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {[-0.05, 0.05].map((z) => (
        <mesh key={z} position={[0, 0.3, z]} scale={[1, 1.3, 1]}>
          <torusGeometry args={[0.07, 0.01, 8, 16, Math.PI]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function PaperStack({ sheets = 4 }: { sheets?: number }) {
  return (
    <group>
      {Array.from({ length: sheets }, (_, i) => (
        <Box key={i} size={[0.21, 0.006, 0.29]} at={[(i % 2) * 0.006, 0.003 + i * 0.006, (i % 3) * 0.004]} color={PALETTE.paper} rough={0.9} shadow={i === sheets - 1} />
      ))}
    </group>
  );
}

export function Plant({ height = 1, small = false }: { height?: number; small?: boolean }) {
  const pot = small ? 0.08 : 0.16;
  return (
    <group>
      <Cylinder r={pot * 0.8} top={pot} h={pot * 1.6} at={[0, pot * 0.8, 0]} color={PALETTE.terracotta} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        const lean = small ? 0.1 : 0.22;
        return (
          <mesh key={i} position={[Math.sin(a) * lean, pot * 1.6 + height * (small ? 0.12 : 0.3), Math.cos(a) * lean]} scale={[1, 1.6, 0.5]} rotation={[0, a, Math.sin(a) * 0.4]} castShadow>
            <sphereGeometry args={[small ? 0.06 : 0.16 * height, 12, 10]} />
            <meshStandardMaterial color={i % 2 ? PALETTE.leaf : PALETTE.leafDeep} roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/** 벽에 붙이는 판(표지판·화면). 앞은 +Z. */
export function Panel({ w, h, texture, emissive = 0, color = "#ffffff" }: { w: number; h: number; texture: ReturnType<typeof useTextTexture>; emissive?: number; color?: string }) {
  return (
    <mesh>
      <planeGeometry args={[w, h]} />
      {texture ? (
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={emissive} roughness={0.6} />
      ) : (
        <meshStandardMaterial color={color} />
      )}
    </mesh>
  );
}

export function signTexture(text: string, bg: string = PALETTE.green, fg = "#FFFFFF") {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = `700 ${Math.round(h * 0.5)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2);
  };
}

export { FONT };
