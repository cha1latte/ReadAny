import { evictBlobCache } from "@/components/reader/ReaderView";
import { DesktopWindowControls } from "@/components/layout/DesktopWindowControls";
/**
 * TabBar — floating capsule tab bar with backdrop blur.
 *
 * macOS: native traffic lights (left), tabs in center capsule
 * Windows/Linux: custom window controls (right), tabs in center capsule
 */
import { type Tab, useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSyncStore } from "@/stores/sync-store";
import { useThemeStore } from "@readany/core/theme";
import { BookOpen, Home, MessageSquare, NotebookPen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TAB_ICONS: Record<string, React.ElementType> = {
  home: Home,
  reader: BookOpen,
  chat: MessageSquare,
  notes: NotebookPen,
};

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as Record<string, string>;

function usePlatformInfo() {
  const [info, setInfo] = useState({ isTauri: false, isMac: false, isWinOrLinux: false });
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setInfo({
      isTauri: "__TAURI_INTERNALS__" in window,
      isMac: ua.includes("mac"),
      isWinOrLinux: !ua.includes("mac"),
    });
  }, []);
  return info;
}

function useIsFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const check = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        setFs(await w.isFullscreen());
        const unlisten = await w.onResized(async () => { setFs(await w.isFullscreen()); });
        return unlisten;
      } catch { return undefined; }
    };
    let unlisten: (() => void) | undefined;
    check().then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);
  return fs;
}

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useAppStore();
  const removeReaderTab = useReaderStore((s) => s.removeTab);
  const books = useLibraryStore((s) => s.books);
  const { isMac, isTauri } = usePlatformInfo();
  const isFullscreen = useIsFullscreen();
  const headerRef = useRef<HTMLDivElement | null>(null);
  const backdropBlur = useThemeStore((s) => s.getCurrentTheme().style.backdropBlur);

  const visibleTabs = tabs.filter((t) => t.type !== "home");

  const handleTabClose = (tabId: string) => {
    const closingTab = tabs.find((t) => t.id === tabId);
    const isBookTab = !!closingTab?.bookId;
    if (closingTab?.bookId) {
      const book = books.find((b) => b.id === closingTab.bookId);
      if (book?.filePath) evictBlobCache(book.filePath);
    }
    removeTab(tabId);
    removeReaderTab(tabId);
    const remainingNonHome = tabs.filter((t) => t.type !== "home" && t.id !== tabId);
    if (remainingNonHome.length === 0) setActiveTab("home");
    if (isBookTab) {
      useSyncStore.getState().syncNow?.();
    }
  };

  return (
    <div
      ref={headerRef}
      className="flex h-8 shrink-0 select-none items-center"
    >
      {/* macOS: space for native traffic lights */}
      <div className="flex h-full shrink-0 items-center" style={{ paddingLeft: (isMac && !isFullscreen) ? 68 : 4 }}>
        <button
          type="button"
          className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={NO_DRAG_STYLE}
          data-no-window-drag
          onClick={() => setActiveTab("home")}
        >
          <Home className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Floating Capsule Tabs */}
      <div className="flex h-full flex-1 items-center justify-center px-2">
        {visibleTabs.length > 0 && (
          <div
            className="flex h-7 items-center gap-0.5 rounded-full border border-border/50 bg-background/80 px-1.5 shadow-sm"
            style={{ backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)` }}
          >
            {visibleTabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onActivate={() => setActiveTab(tab.id)}
                onClose={() => handleTabClose(tab.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: custom window controls on right */}
      {isTauri && <DesktopWindowControls headerRef={headerRef} />}
    </div>
  );
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const Icon = TAB_ICONS[tab.type] ?? BookOpen;

  return (
    <div
      className={`group flex h-5.5 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-all duration-200 ${
        isActive
          ? "bg-primary/10 text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
      style={NO_DRAG_STYLE}
      data-no-window-drag
      onClick={onActivate}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="max-w-[100px] truncate">{tab.title}</span>
      <button
        type="button"
        className="ml-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:flex"
        data-no-window-drag
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
