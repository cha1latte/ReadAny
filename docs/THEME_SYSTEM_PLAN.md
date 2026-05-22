# 自定义主题系统 - 详细设计方案

## 一、设计理念（参考 Reeden）

**核心原则**：主题 = 配色 + 背景图 + 圆角 + 阴影 + 阅读器样式，作为一个整体打包。

**架构分层**：
```
亮度模式 (light / dark / system)
    ↓ 决定使用哪套色值
主题风格 (default / sepia / nord / paper / ocean / dracula / custom...)
    ↓ 每个风格包含 light + dark 两套色值
阅读器主题 (跟随 App / 独立设置 / 单本书独立)
```

---

## 二、数据结构设计

### ThemeDefinition（核心类型）

```typescript
// packages/core/src/theme/theme-schema.ts

export interface ThemeColorSet {
  // 基础色
  background: string;
  foreground: string;
  // 卡片
  card: string;
  cardForeground: string;
  // 主色
  primary: string;
  primaryForeground: string;
  // 次要色
  secondary: string;
  secondaryForeground: string;
  // 弱调
  muted: string;
  mutedForeground: string;
  // 强调
  accent: string;
  accentForeground: string;
  // 警示
  destructive: string;
  destructiveForeground: string;
  // 边框/输入
  border: string;
  input: string;
  ring: string;
  // 侧栏
  sidebar: string;
  sidebarForeground: string;
  // Popover
  popover: string;
  popoverForeground: string;
}

export interface ReaderColorSet {
  background: string;
  foreground: string;
  linkColor: string;
}

export interface HighlightColors {
  yellow: string;
  green: string;
  blue: string;
  pink: string;
  purple: string;
}

export interface ThemeStyle {
  /** 全局圆角基础值 (rem) */
  radius: number;
  /** 卡片阴影强度: 'none' | 'sm' | 'md' | 'lg' */
  shadowLevel: 'none' | 'sm' | 'md' | 'lg';
  /** 边框风格: 'none' | 'subtle' | 'normal' */
  borderStyle: 'none' | 'subtle' | 'normal';
  /** 背景模糊度（用于毛玻璃效果）*/
  backdropBlur: number;
}

export interface ThemeBackground {
  /** 图片 URL（内置资源路径或用户上传的本地路径）*/
  image?: string;
  /** 背景图透明度 0-1 */
  opacity?: number;
  /** 背景图模糊度 px */
  blur?: number;
  /** 背景图填充模式 */
  fillMode?: 'cover' | 'contain' | 'tile' | 'stretch';
}

export interface ThemeDefinition {
  id: string;
  name: string;
  nameEn?: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;

  // 两套色值
  light: ThemeColorSet;
  dark: ThemeColorSet;

  // 阅读器颜色（可选，不设则从 light/dark 推导）
  reader?: {
    light: ReaderColorSet;
    dark: ReaderColorSet;
  };

  // 高亮色（可选，不设则用默认）
  highlights?: HighlightColors;

  // 界面风格
  style: ThemeStyle;

  // 背景图
  appBackground?: ThemeBackground;
  readerBackground?: ThemeBackground;
}
```

---

## 三、现有代码改造点

### 3.1 桌面端 App UI

**文件**: `packages/app/src/styles/globals.css`  
**当前**: 硬编码 3 套主题（:root / [data-theme="dark"] / [data-theme="sepia"]）  
**改造**:
- 保留 `:root` 中的 CSS 变量声明（作为 fallback）
- 移除 `[data-theme="dark"]` 和 `[data-theme="sepia"]` 硬编码块
- 新建 `packages/app/src/lib/theme-injector.ts`：从 theme store 读取当前色值 → 批量 `document.documentElement.style.setProperty('--xxx', value)`
- 新增 CSS 变量:
  - `--radius` → 从 `theme.style.radius` 读取
  - `--app-bg-image` → 背景图
  - `--app-bg-opacity` → 背景图透明度
  - `--app-bg-blur` → 背景图模糊度

**新增背景图层** (`AppLayout.tsx`):
```tsx
{/* 背景图层 — 在所有内容后面 */}
<div
  className="fixed inset-0 -z-10 bg-cover bg-center"
  style={{
    backgroundImage: theme.appBackground?.image ? `url(${theme.appBackground.image})` : 'none',
    opacity: theme.appBackground?.opacity ?? 1,
    filter: `blur(${theme.appBackground?.blur ?? 0}px)`,
  }}
/>
```

### 3.2 桌面端阅读器

**文件**: `packages/app/src/components/reader/FoliateViewer.tsx`  
**当前**: `THEME_COLORS` 硬编码 3 色 × 3 主题  
**改造**:
- 删除 `THEME_COLORS` 常量
- 从 theme store 读取 `theme.reader?.light/dark` 或从 `theme.light/dark` 推导
- 阅读器背景纹理：通过 CSS `background-image` 注入到 iframe body

```typescript
function getReaderColors(): { bg: string; fg: string; link: string } {
  const theme = useThemeStore.getState().currentTheme;
  const isDark = useThemeStore.getState().resolvedMode === 'dark';
  const readerColors = theme.reader?.[isDark ? 'dark' : 'light'];
  if (readerColors) return readerColors;
  // 从 app 色值推导
  const colors = isDark ? theme.dark : theme.light;
  return { bg: colors.background, fg: colors.foreground, link: colors.primary };
}
```

### 3.3 移动端 App UI

**文件**: `packages/app-expo/src/styles/ThemeContext.tsx`  
**当前**: 硬编码 `lightColors` / `darkColors` / `sepiaColors` 对象  
**改造**:
- `ThemeProvider` 从 theme store 读取颜色
- `ThemeColors` 接口保持不变（向后兼容）
- 颜色值改为动态计算而非硬编码

```typescript
// ThemeProvider 内部
const theme = useThemeStore((s) => s.currentTheme);
const resolvedMode = useThemeStore((s) => s.resolvedMode);
const colorSet = resolvedMode === 'dark' ? theme.dark : theme.light;
const colors: ThemeColors = mapColorSetToThemeColors(colorSet, theme.highlights);
```

### 3.4 移动端阅读器

**文件**: `packages/app-expo/assets/reader/reader.template.html`  
**当前**: postMessage 传入 `{ background, foreground, muted, primary }`  
**改造**:
- 扩展传入字段：加 `linkColor`, `readerBgImage`, `readerBgOpacity`
- 阅读器 body 支持 `background-image` 设置

### 3.5 悬浮 Tab 栏

**文件**: `packages/app/src/components/layout/TabBar.tsx`  
**当前**: `h-8 bg-muted` 固定顶部条  
**改造**:
```tsx
// 从固定顶部条 → 居中悬浮胶囊
<div className={cn(
  "flex h-9 items-center gap-1 rounded-full",
  "bg-background/80 backdrop-blur-md",
  "border border-border/50 shadow-lg",
  "px-3 mx-auto w-fit",
  // 过渡动画
  "transition-all duration-300",
  isHidden && "-translate-y-full opacity-0"
)}>
```

---

## 四、内置主题列表

| ID | 名称 | 类型 | 说明 |
|---|---|---|---|
| `default` | Default | 通用 | 当前的 light/dark |
| `sepia` | Warm Paper | 护眼 | 当前的 sepia（同时有暖色 dark 版） |
| `nord` | Nord | 冷色 | 北欧蓝调 |
| `paper` | Paper | 极简 | 纯白/纯黑，无彩色 |
| `ocean` | Ocean | 冷色 | 深海蓝绿调 |
| `forest` | Forest | 暖色 | 森林绿调 |
| `rosepine` | Rosé Pine | 流行 | 社区流行配色 |
| `dracula` | Dracula | 流行 | 经典暗色主题 |

---

## 五、内置纹理/背景图列表

| ID | 名称 | 适用 | 说明 |
|---|---|---|---|
| `paper-light` | 浅色纸张 | App/Reader | 轻微纸张纹理 |
| `paper-dark` | 深色纸张 | App/Reader | 暗色纸张质感 |
| `kraft` | 牛皮纸 | Reader | 棕色牛皮纸 |
| `parchment` | 羊皮纸 | Reader | 古典羊皮纸 |
| `linen` | 亚麻布 | App | 细腻布纹 |
| `concrete` | 水泥 | App | 工业风 |
| `wood` | 木纹 | App | 温暖木纹 |

---

## 六、Theme Store 设计

```typescript
// packages/core/src/theme/theme-store.ts

interface ThemeState {
  // 当前选中的主题 ID
  activeThemeId: string;
  // 亮暗模式: light | dark | system
  mode: 'light' | 'dark' | 'system';
  // 解析后的实际模式（system 会根据系统决定）
  resolvedMode: 'light' | 'dark';
  // 当前主题定义（计算属性）
  currentTheme: ThemeDefinition;
  // 用户自定义主题列表
  customThemes: ThemeDefinition[];
  // 单本书阅读主题覆盖 (bookId → themeId)
  bookThemeOverrides: Record<string, string>;

  // Actions
  setTheme: (themeId: string) => void;
  setMode: (mode: 'light' | 'dark' | 'system') => void;
  addCustomTheme: (theme: ThemeDefinition) => void;
  updateCustomTheme: (id: string, updates: Partial<ThemeDefinition>) => void;
  deleteCustomTheme: (id: string) => void;
  setBookTheme: (bookId: string, themeId: string | null) => void;
  exportTheme: (themeId: string) => string; // JSON string
  importTheme: (json: string) => ThemeDefinition;
}
```

---

## 七、实现分 Phase

### Phase 1: 核心架构 + 配色切换（1 周）
- [ ] `packages/core/src/theme/` 模块：schema + store + builtin themes
- [ ] 桌面端 theme-injector：动态写入 CSS 变量
- [ ] 移动端 ThemeContext 对接 theme store
- [ ] 设置页主题选择器 UI（预览卡片）
- [ ] 迁移：现有 light/dark/sepia 无感迁移

### Phase 2: 阅读器主题 + 背景图（1 周）
- [ ] 阅读器从 theme store 读取颜色
- [ ] App 背景图层实现（桌面 + 移动）
- [ ] 阅读器背景纹理注入
- [ ] 内置纹理资源打包
- [ ] 单本书主题覆盖

### Phase 3: 悬浮 Tab 栏 + 风格参数（1 周）
- [ ] TabBar 改造为居中悬浮胶囊
- [ ] 圆角/阴影/边框风格从 theme store 读取
- [ ] 毛玻璃效果适配
- [ ] 主题联动（App → Reader 联动开关）

### Phase 4: 自定义 + 导入导出（1 周）
- [ ] 自定义主题编辑器（颜色选择器 + 实时预览）
- [ ] 主题导出 JSON / 导入 JSON
- [ ] 同步：主题配置纳入 WebDAV 同步
- [ ] 内置 8 个预设主题精调

---

## 八、关键设计决策

1. **护眼（sepia）不再是独立模式** — 它是一个主题风格，同时有 light 和 dark 两个版本。light 版就是现在的护眼色；dark 版是暖黑底 + 米黄字。

2. **阅读器主题可独立也可跟随** — 默认跟随 App 主题，用户可以手动设置"阅读时使用 XX 主题"。还支持单本书独立主题。

3. **背景图和颜色绑定在主题中** — 不是单独的"壁纸"设置，而是主题的一部分。切换主题时背景图一起换。

4. **向后兼容** — 老版本设置的 `readany-theme: "sepia"` 自动映射到新的 `activeThemeId: "sepia"` + `mode: "light"`。

5. **CSS 变量是唯一的注入点** — 所有平台最终都通过 CSS 变量消费颜色（RN 端通过 JS 对象中转，但数据来源是同一个 theme store）。
