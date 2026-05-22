/**
 * Built-in texture/background presets.
 *
 * Each texture has a unique ID and a path relative to the app's public/assets directory.
 * Desktop: /textures/xxx.webp (served from public/)
 * Mobile: bundled via asset system
 */

export interface TexturePreset {
  id: string;
  name: string;
  nameEn: string;
  /** Relative path to the texture image */
  path: string;
  /** Suggested opacity for this texture */
  defaultOpacity: number;
  /** Suitable for app background, reader, or both */
  scope: "app" | "reader" | "both";
}

export const BUILTIN_TEXTURES: TexturePreset[] = [
  {
    id: "paper-light",
    name: "浅色纸张",
    nameEn: "Light Paper",
    path: "/textures/paper-light.webp",
    defaultOpacity: 0.08,
    scope: "both",
  },
  {
    id: "paper-dark",
    name: "深色纸张",
    nameEn: "Dark Paper",
    path: "/textures/paper-dark.webp",
    defaultOpacity: 0.1,
    scope: "both",
  },
  {
    id: "kraft",
    name: "牛皮纸",
    nameEn: "Kraft Paper",
    path: "/textures/kraft.webp",
    defaultOpacity: 0.12,
    scope: "reader",
  },
  {
    id: "parchment",
    name: "羊皮纸",
    nameEn: "Parchment",
    path: "/textures/parchment.webp",
    defaultOpacity: 0.1,
    scope: "reader",
  },
  {
    id: "linen",
    name: "亚麻布",
    nameEn: "Linen",
    path: "/textures/linen.webp",
    defaultOpacity: 0.06,
    scope: "app",
  },
  {
    id: "concrete",
    name: "水泥",
    nameEn: "Concrete",
    path: "/textures/concrete.webp",
    defaultOpacity: 0.05,
    scope: "app",
  },
  {
    id: "wood",
    name: "木纹",
    nameEn: "Wood Grain",
    path: "/textures/wood.webp",
    defaultOpacity: 0.08,
    scope: "app",
  },
];

export function getTextureById(id: string): TexturePreset | undefined {
  return BUILTIN_TEXTURES.find((t) => t.id === id);
}
