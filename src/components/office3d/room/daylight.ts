/**
 * 시각별 빛(맥 앱 기획서 4장 표를 three.js 세기로 옮김). 사이 시각은 선형으로 섞는다.
 * 노을색은 햇빛에만 두고 그늘(주변광·채움광)은 거의 무채색: 그늘까지 주황이면 화면 전체가 바랜 사진처럼 탁하다.
 * SceneKit 세기 → three.js: 해 ÷700, 주변광 ÷380, 채움광 ÷520.
 */
import { Color } from "three";

interface Key {
  minute: number;
  sun: number; elevation: number; azimuth: number; sunColor: string;
  ambient: number; ambientColor: string;
  fill: number; fillColor: string;
  ceiling: number; hall: number; lamp: number;
  sky: [string, string, string];
  background: string;
  glass: string;
}

const h = (hh: number, mm = 0) => hh * 60 + mm;

const KEYS: Key[] = [
  { minute: h(6), sun: 0, elevation: 6, azimuth: 24, sunColor: "#FFC58A", ambient: 250, ambientColor: "#A9B6DA", fill: 200, fillColor: "#B8C2E0", ceiling: 0.6, hall: 1, lamp: 0.6, sky: ["#51648F", "#8C93B5", "#E2B9A0"], background: "#4B5578", glass: "#B9C6E2" },
  { minute: h(8), sun: 1700, elevation: 15, azimuth: 22, sunColor: "#FFD49A", ambient: 330, ambientColor: "#FFF2DF", fill: 330, fillColor: "#FFF0DA", ceiling: 0.15, hall: 0.3, lamp: 0.5, sky: ["#9CC9EA", "#D5E6EE", "#FBE3BF"], background: "#EDE4D2", glass: "#F3F3E6" },
  { minute: h(9), sun: 2100, elevation: 21, azimuth: 18, sunColor: "#FFDCA6", ambient: 360, ambientColor: "#FFF4E2", fill: 370, fillColor: "#FFF3E0", ceiling: 0, hall: 0, lamp: 0.45, sky: ["#8FC4EC", "#CFE5F1", "#FAE9C9"], background: "#EFE7D6", glass: "#F4F6EC" },
  { minute: h(12, 30), sun: 1900, elevation: 60, azimuth: 0, sunColor: "#FFF7EA", ambient: 340, ambientColor: "#FBF6EC", fill: 340, fillColor: "#FFF8EC", ceiling: 0, hall: 0, lamp: 0.3, sky: ["#6DB6EE", "#B5DCF5", "#E8F3F7"], background: "#F1EBDD", glass: "#F2F8F8" },
  { minute: h(15, 30), sun: 2100, elevation: 42, azimuth: -10, sunColor: "#FFF0D6", ambient: 370, ambientColor: "#FFF7EA", fill: 370, fillColor: "#FFF8EA", ceiling: 0, hall: 0, lamp: 0.35, sky: ["#7ABDED", "#BFE0F3", "#F1F0E2"], background: "#F0E9DA", glass: "#F4F6EE" },
  { minute: h(17), sun: 1450, elevation: 22, azimuth: -18, sunColor: "#FFCB8C", ambient: 350, ambientColor: "#FCEEE2", fill: 350, fillColor: "#FCECDD", ceiling: 0.1, hall: 0.2, lamp: 0.5, sky: ["#8DB4E2", "#E3D6D2", "#FFD3A0"], background: "#EEE4D7", glass: "#F7E9D6" },
  { minute: h(18), sun: 1050, elevation: 10.5, azimuth: -22, sunColor: "#FF9A54", ambient: 290, ambientColor: "#F3E4DA", fill: 270, fillColor: "#F5E0D2", ceiling: 0.3, hall: 0.6, lamp: 0.7, sky: ["#7F8FCB", "#F3A98C", "#FF8A52"], background: "#E4D6CC", glass: "#F8C9A6" },
  { minute: h(19), sun: 0, elevation: 3, azimuth: -24, sunColor: "#E0705A", ambient: 220, ambientColor: "#B9BDE2", fill: 150, fillColor: "#AEB6E0", ceiling: 0.75, hall: 1, lamp: 1, sky: ["#2B3A72", "#65588C", "#C9796D"], background: "#3F426B", glass: "#8E8FC0" },
  { minute: h(20), sun: 0, elevation: 30, azimuth: 0, sunColor: "#8CA2E6", ambient: 150, ambientColor: "#8F9DDC", fill: 95, fillColor: "#8496E0", ceiling: 0, hall: 1, lamp: 1, sky: ["#0E1638", "#18265A", "#2A3A78"], background: "#1B2244", glass: "#54629E" },
  { minute: h(23, 59), sun: 0, elevation: 30, azimuth: 0, sunColor: "#8CA2E6", ambient: 135, ambientColor: "#8491D2", fill: 85, fillColor: "#7C8EDA", ceiling: 0, hall: 1, lamp: 1, sky: ["#090F2A", "#111C48", "#1F2C62"], background: "#151B3A", glass: "#4A5790" },
];

export interface Light {
  sunIntensity: number;
  /** 빛이 나아가는 방향(정규화 전). */
  sunDirection: [number, number, number];
  sunColor: Color;
  ambientIntensity: number;
  ambientColor: Color;
  fillIntensity: number;
  fillColor: Color;
  ceiling: number;
  hall: number;
  lamp: number;
  sky: [Color, Color, Color];
  background: Color;
  glass: Color;
  /** 0 낮 ~ 1 밤(꺼진 전구·화면 밝기 조절용). */
  night: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixColor = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t);

/** 자정에서 지난 분(소수 가능) → 빛. */
export function lightAt(minute: number): Light {
  const m = Math.min(Math.max(minute, KEYS[0].minute), KEYS[KEYS.length - 1].minute);
  let i = KEYS.findIndex((k) => k.minute > m);
  if (i <= 0) i = i === 0 ? 1 : KEYS.length - 1;
  const a = KEYS[i - 1];
  const b = KEYS[i];
  const t = b.minute === a.minute ? 0 : (m - a.minute) / (b.minute - a.minute);
  const elevation = (mix(a.elevation, b.elevation, t) * Math.PI) / 180;
  const azimuth = (mix(a.azimuth, b.azimuth, t) * Math.PI) / 180;
  const ambient = mix(a.ambient, b.ambient, t);
  return {
    sunIntensity: mix(a.sun, b.sun, t) / 700,
    sunDirection: [-Math.cos(elevation) * Math.cos(azimuth), -Math.sin(elevation), -Math.cos(elevation) * Math.sin(azimuth)],
    sunColor: mixColor(a.sunColor, b.sunColor, t),
    ambientIntensity: ambient / 380,
    ambientColor: mixColor(a.ambientColor, b.ambientColor, t),
    fillIntensity: mix(a.fill, b.fill, t) / 520,
    fillColor: mixColor(a.fillColor, b.fillColor, t),
    ceiling: mix(a.ceiling, b.ceiling, t),
    hall: mix(a.hall, b.hall, t),
    lamp: mix(a.lamp, b.lamp, t),
    sky: [mixColor(a.sky[0], b.sky[0], t), mixColor(a.sky[1], b.sky[1], t), mixColor(a.sky[2], b.sky[2], t)],
    background: mixColor(a.background, b.background, t),
    glass: mixColor(a.glass, b.glass, t),
    night: 1 - Math.min(1, ambient / 340),
  };
}
