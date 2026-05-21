# 自定义主题系统 - 改造梳理

## 一、当前需要主题变量控制的位置

### 1. 桌面端 App UI (`packages/app/src/styles/globals.css`)
**当前方案**: `data-theme` 属性 + CSS 变量  
**变量数量**: ~27 个颜色变量 + 5 个高亮色 + 阴影/圆角  
**主题数**: light / dark / sepia（3 套硬编码）

需要控制的变量：
- `--background` / `--foreground` — 页面底色/文字色
- `--card` / `--card-foreground` — 卡片背景/文字
- `--primary` / `--primary-foreground` — 主色调/主色上文字
- `--secondary` / `--secondary-foreground`
- `--muted` / `--muted-foreground` — 弱调背景/弱调文字
- `--accent` / `--accent-foreground`
- `--destructive` / `--destructive-foreground`
- `--border` / `--input` / `--ring`
- `--sidebar` / `--sidebar-foreground`
- `--color-highlight-*`（5 色高亮）
- **新增**: `--background-image` — App 背景图

### 2. 桌面端阅读器 (`packages/app/src/components/reader/FoliateViewer.tsx`)
**当前方案**: `THEME_COLORS` 硬编码对象 + inline CSS 注入 iframe  
**变量**: bg / fg / link（3 个颜色 × 3 个主题）

需要控制的变量：
- 阅读器背景色
- 阅读器文字色
- 链接色
- **新增**: 阅读器背景图（texture/pattern）

### 3. 移动端 App UI (`packages/app-expo/src/styles/ThemeContext.tsx`)
**当前方案**: React Context + 硬编码 `ThemeColors` 对象  
**变量数量**: ~33 个颜色属性 × 3 套主题

需要控制的变量（同 `ThemeColors` 接口）：
- background / foreground / card / cardForeground
- muted / mutedForeground / border
- primary / primaryForeground
- destructive / accent 等
- highlight 颜色 × 5
- stone 渐变 × 5
- **新增**: backgroundImage

### 4. 移动端阅读器 (`packages/app-expo/assets/reader/reader.template.html`)
**当前方案**: postMessage 传颜色 → `document.documentElement.style.setProperty`  
**变量**: `--bg` / `--fg` / `--muted` / `--primary`（4 个）

需要控制的变量：
- 阅读器背景色 (`--bg`)
- 阅读器文字色 (`--fg`)
- 弱调文字 (`--muted`)
- 主色 (`--primary`)
- **新增**: 阅读器背景图 (`--reader-bg-image`)

---

## 二、新增功能需求

### A. App 背景图
- 整个应用的底层背景可以设置图片/纹理
- 需要半透明的 card/sidebar 来透出背景
- 移动端和桌面端都要支持
- 内置几套纹理 + 用户自定义上传

### B. 阅读器背景图
- 阅读器独立于 App 背景，可以单独设置纸张纹理
- 比如：牛皮纸、宣纸、羊皮纸等质感
- 需要同时适配 iframe（桌面）和 WebView（移动端）
- 注意不能影响文字可读性（需要 overlay 叠加）

### C. 悬浮 Tab 栏
- 当前 TabBar 是固定在顶部的 absolute 定位
- 改为悬浮式：毛玻璃效果 + 圆角 + 阴影
- 在阅读器模式下自动隐藏（hover 顶部唤出）
- 位置可能调整为居中悬浮（类 Arc 浏览器风格）

---

## 三、目标数据结构

```typescript
interface ThemeDefinition {
  id: string;
  name: string;
  builtIn: boolean;
  
  // 两套色值：light 和 dark（system 模式下根据系统选择）
  light: ThemeColorSet;
  dark: ThemeColorSet;
  
  // 阅读器专用（可选，不设置则跟随 App 主题）
  reader?: {
    light: ReaderColorSet;
    dark: ReaderColorSet;
  };
  
  // 背景图（可选）
  backgroundImage?: {
    app?: string;       // App 背景图 URL/asset
    reader?: string;    // 阅读器背景纹理 URL/asset
    opacity?: number;   // 背景图透明度 0-1
  };
}

interface ThemeColorSet {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  // 高亮色
  highlightYellow: string;
  highlightGreen: string;
  highlightBlue: string;
  highlightPink: string;
  highlightPurple: string;
}

interface ReaderColorSet {
  background: string;
  foreground: string;
  linkColor: string;
}
```

---

## 四、改造步骤（按优先级）

### Phase 1: 基础架构
1. `packages/core/src/theme/` — 新建主题模块
   - `theme-schema.ts` — 类型定义
   - `builtin-themes.ts` — 内置主题（default, sepia, nord, paper, ocean, forest, rosepine, dracula）
   - `theme-store.ts` — zustand store（当前主题、亮暗模式、自定义列表）
2. 迁移现有 3 套主题为 ThemeDefinition 格式

### Phase 2: 桌面端接入
3. `globals.css` — 改为动态注入（JS 读取 theme store → 写 CSS 变量）
4. `FoliateViewer.tsx` — 从 theme store 读阅读器颜色
5. 设置页 UI — 主题选择器（预览卡片 + 颜色球）

### Phase 3: 移动端接入
6. `ThemeContext.tsx` — 从 theme store 读颜色
7. `reader.template.html` — 通过 postMessage 接收完整主题色

### Phase 4: 背景图
8. App 背景图系统 — 桌面/移动端实现
9. 阅读器纹理 — iframe/WebView 注入
10. 内置纹理资源

### Phase 5: 悬浮 Tab 栏
11. `TabBar.tsx` 改造 — 居中悬浮 + 毛玻璃 + 圆角
12. 阅读器模式自动隐藏交互

### Phase 6: 自定义 & 社区
13. 颜色编辑器 UI
14. 主题导入/导出（JSON）
15. 可选：主题分享/社区

---

## 五、文件改动清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/theme/` (新建) | 主题模块 |
| `packages/core/src/stores/settings-store.ts` | 集成 theme store |
| `packages/app/src/styles/globals.css` | 移除硬编码，改为 JS 动态注入 |
| `packages/app/src/main.tsx` | 启动时应用主题 |
| `packages/app/src/components/settings/GeneralSettings.tsx` | 主题选择器 UI |
| `packages/app/src/components/reader/FoliateViewer.tsx` | 读 theme store |
| `packages/app/src/components/layout/TabBar.tsx` | 悬浮改造 |
| `packages/app/src/components/layout/AppLayout.tsx` | 背景图层 |
| `packages/app-expo/src/styles/ThemeContext.tsx` | 从 theme store 读取 |
| `packages/app-expo/assets/reader/reader.template.html` | 接收完整主题 |
| `packages/app-expo/src/screens/ProfileScreen.tsx` | 外观设置入口 |
