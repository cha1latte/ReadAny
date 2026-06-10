import { KnowledgeEditor, type KnowledgeEditorValue } from "@/components/knowledge/KnowledgeEditor";
import { SyncButton } from "@/components/ui/SyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { useResolvedSrc, useSyncVersion } from "@/hooks/use-resolved-src";
import type { HighlightWithBook } from "@/lib/db/database";
import {
  ensureBookHomeDocument,
  getBook as getBookRecord,
  updateKnowledgeDocument,
} from "@/lib/db/database";
import { openDesktopBook } from "@/lib/library/open-book";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { type ExportFormat, annotationExporter } from "@readany/core/export";
import { markdownToBasicTiptap, renderKnowledgeJsonToMarkdown } from "@readany/core/knowledge";
import { sortAnnotationsByPosition } from "@readany/core/reader";
import type { Highlight, KnowledgeDocument, Note } from "@readany/core/types";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { cn } from "@readany/core/utils";
import { eventBus } from "@readany/core/utils/event-bus";
import {
  BookOpen,
  Check,
  ChevronLeft,
  Edit3,
  FileText,
  Highlighter,
  NotebookPen,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
/**
 * NotesPage — Notebook-style knowledge management center
 * Layout: Left panel (book notebooks grid) + Right panel (selected book's notes & highlights)
 * Notes and highlights are displayed separately.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { ExportDropdown } from "./ExportDropdown";

type DetailTab = "knowledge" | "notes" | "highlights";

function createEmptyKnowledgeValue(): KnowledgeEditorValue {
  return {
    contentJson: { type: "doc", content: [] },
    contentMd: "",
    plainText: "",
  };
}

function isEmptyTiptapDocument(content: KnowledgeDocument["contentJson"]): boolean {
  return (
    !!content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    content.type === "doc" &&
    (!Array.isArray(content.content) || content.content.length === 0)
  );
}

function knowledgeValueFingerprint(value: KnowledgeEditorValue): string {
  return `${value.contentMd}\n${JSON.stringify(value.contentJson)}`;
}

function createKnowledgeValueFromDocument(document: KnowledgeDocument): KnowledgeEditorValue {
  const shouldImportMarkdown =
    !!document.contentMd.trim() && isEmptyTiptapDocument(document.contentJson);
  const contentJson = shouldImportMarkdown
    ? (markdownToBasicTiptap(document.contentMd) as unknown as KnowledgeDocument["contentJson"])
    : document.contentJson;
  const contentMd = document.contentMd || renderKnowledgeJsonToMarkdown(contentJson);

  return {
    contentJson,
    contentMd,
    plainText: createKnowledgeExcerpt(contentMd) ?? "",
  };
}

function createKnowledgeExcerpt(markdown: string): string | undefined {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 220) : undefined;
}

// Helper component to resolve and display cover images
interface CoverImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  url: string | undefined | null;
  fallback?: React.ReactNode;
}

function CoverImage({ url, fallback, alt = "", ...imgProps }: CoverImageProps) {
  const resolvedSrc = useResolvedSrc(url ?? undefined);
  const syncVersion = useSyncVersion();
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const imageKey = resolvedSrc ? `${resolvedSrc}-${syncVersion}` : null;

  if (!resolvedSrc || imageKey === failedKey) {
    return <>{fallback}</>;
  }

  return (
    <img
      key={imageKey}
      src={resolvedSrc}
      onError={() => setFailedKey(imageKey)}
      {...imgProps}
      alt={alt}
    />
  );
}

export function NotesPage() {
  const { t } = useTranslation();
  const {
    highlightsWithBooks,
    loadAllHighlightsWithBooks,
    removeHighlight,
    updateHighlight,
    stats,
    loadStats,
  } = useAnnotationStore();
  const { activeTabId } = useAppStore();
  const books = useLibraryStore((s) => s.books);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("knowledge");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [knowledgeHome, setKnowledgeHome] = useState<KnowledgeDocument | null>(null);
  const [knowledgeValue, setKnowledgeValue] =
    useState<KnowledgeEditorValue>(createEmptyKnowledgeValue);
  const [savedKnowledgeFingerprint, setSavedKnowledgeFingerprint] = useState(
    knowledgeValueFingerprint(createEmptyKnowledgeValue()),
  );
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);
  const [isKnowledgeSaving, setIsKnowledgeSaving] = useState(false);
  const knowledgeSaveVersionRef = useRef(0);
  const currentKnowledgeFingerprint = useMemo(
    () => knowledgeValueFingerprint(knowledgeValue),
    [knowledgeValue],
  );

  useEffect(() => {
    if (activeTabId !== "notes") return;
    setIsLoading(true);
    Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() => setIsLoading(false));
  }, [loadAllHighlightsWithBooks, loadStats, activeTabId]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      if (activeTabId !== "notes") return;
      setIsLoading(true);
      Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() =>
        setIsLoading(false),
      );
    });
  }, [activeTabId, loadAllHighlightsWithBooks, loadStats]);

  // Group highlights by book, but keep every library book available as a knowledge workspace.
  const bookNotebooks = useMemo(() => {
    const grouped = new Map<
      string,
      {
        bookId: string;
        title: string;
        author: string;
        coverUrl: string | null;
        highlights: HighlightWithBook[];
        notesCount: number;
        highlightsOnlyCount: number;
        latestAt: number;
      }
    >();

    for (const book of books) {
      if (book.deletedAt) continue;
      grouped.set(book.id, {
        bookId: book.id,
        title: book.meta.title || t("notes.unknownBook"),
        author: book.meta.author || t("notes.unknownAuthor"),
        coverUrl: book.meta.coverUrl || null,
        highlights: [],
        notesCount: 0,
        highlightsOnlyCount: 0,
        latestAt: book.lastOpenedAt || book.updatedAt || book.addedAt,
      });
    }

    for (const h of highlightsWithBooks) {
      const existing = grouped.get(h.bookId);
      if (existing) {
        existing.highlights.push(h);
        if (h.note) existing.notesCount++;
        else existing.highlightsOnlyCount++;
        if (h.updatedAt > existing.latestAt) existing.latestAt = h.updatedAt;
      } else {
        grouped.set(h.bookId, {
          bookId: h.bookId,
          title: h.bookTitle || t("notes.unknownBook"),
          author: h.bookAuthor || t("notes.unknownAuthor"),
          coverUrl: h.bookCoverUrl || null,
          highlights: [h],
          notesCount: h.note ? 1 : 0,
          highlightsOnlyCount: h.note ? 0 : 1,
          latestAt: h.createdAt,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [books, highlightsWithBooks, t]);

  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return bookNotebooks.find((b) => b.bookId === selectedBookId) || null;
  }, [selectedBookId, bookNotebooks]);
  const selectedKnowledgeBookId = selectedBook?.bookId ?? null;
  const selectedKnowledgeBookTitle = selectedBook?.title ?? "";

  useEffect(() => {
    if (!selectedBookId) return;
    if (bookNotebooks.some((book) => book.bookId === selectedBookId)) return;

    setSelectedBookId(null);
    setDetailTab("knowledge");
    setSearchQuery("");
    setEditingId(null);
  }, [bookNotebooks, selectedBookId]);

  // Split into notes (has note text) and highlights-only
  const { notes, highlightsOnly } = useMemo(() => {
    if (!selectedBook) return { notes: [], highlightsOnly: [] };
    let all = selectedBook.highlights;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      all = all.filter(
        (h) =>
          h.text.toLowerCase().includes(q) ||
          h.note?.toLowerCase().includes(q) ||
          h.chapterTitle?.toLowerCase().includes(q),
      );
    }
    const sorted = sortAnnotationsByPosition(all);
    return {
      notes: sorted.filter((h) => h.note),
      highlightsOnly: sorted.filter((h) => !h.note),
    };
  }, [selectedBook, searchQuery]);

  const currentList =
    detailTab === "notes" ? notes : detailTab === "highlights" ? highlightsOnly : [];

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter");
      const arr = chapters.get(chapter) || [];
      arr.push(h);
      chapters.set(chapter, arr);
    }
    return chapters;
  }, [currentList, t]);

  useEffect(() => {
    let cancelled = false;

    async function loadKnowledgeHome() {
      knowledgeSaveVersionRef.current += 1;

      if (!selectedKnowledgeBookId) {
        setKnowledgeHome(null);
        const emptyValue = createEmptyKnowledgeValue();
        setKnowledgeValue(emptyValue);
        setSavedKnowledgeFingerprint(knowledgeValueFingerprint(emptyValue));
        setIsKnowledgeSaving(false);
        return;
      }

      setIsKnowledgeLoading(true);
      setIsKnowledgeSaving(false);
      try {
        const document = await ensureBookHomeDocument(
          selectedKnowledgeBookId,
          selectedKnowledgeBookTitle,
        );
        if (cancelled) return;
        const nextValue = createKnowledgeValueFromDocument(document);
        setKnowledgeHome(document);
        setKnowledgeValue(nextValue);
        setSavedKnowledgeFingerprint(knowledgeValueFingerprint(nextValue));
      } catch (error) {
        console.error("[Notes] Failed to load knowledge home:", error);
        toast.error(t("notes.knowledgeLoadFailed"));
      } finally {
        if (!cancelled) setIsKnowledgeLoading(false);
      }
    }

    void loadKnowledgeHome();

    return () => {
      cancelled = true;
    };
  }, [selectedKnowledgeBookId, selectedKnowledgeBookTitle, t]);

  useEffect(() => {
    if (!knowledgeHome || currentKnowledgeFingerprint === savedKnowledgeFingerprint) return;

    const saveVersion = knowledgeSaveVersionRef.current + 1;
    knowledgeSaveVersionRef.current = saveVersion;

    const timeout = window.setTimeout(async () => {
      setIsKnowledgeSaving(true);
      try {
        await updateKnowledgeDocument(knowledgeHome.id, {
          contentMd: knowledgeValue.contentMd,
          contentJson: knowledgeValue.contentJson,
          excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
        });
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        setSavedKnowledgeFingerprint(knowledgeValueFingerprint(knowledgeValue));
      } catch (error) {
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        console.error("[Notes] Failed to save knowledge home:", error);
        toast.error(t("notes.knowledgeSaveFailed"));
      } finally {
        if (knowledgeSaveVersionRef.current === saveVersion) {
          setIsKnowledgeSaving(false);
        }
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [knowledgeHome, knowledgeValue, currentKnowledgeFingerprint, savedKnowledgeFingerprint, t]);

  const handleOpenBook = async (bookId: string, _title: string, cfi?: string) => {
    const book =
      books.find((item) => item.id === bookId) ??
      (await getBookRecord(bookId, { includeDeleted: true }).catch((err) => {
        console.warn("[Notes] Failed to get book record:", err);
        return null;
      }));
    if (!book) return;

    await openDesktopBook({
      book,
      t,
      initialCfi: cfi,
    });
  };

  // Delete only the note text, keep the highlight
  const handleDeleteNote = (highlight: HighlightWithBook) => {
    updateHighlight(highlight.id, { note: undefined });
  };

  // Delete the entire highlight record
  const handleDeleteHighlight = (highlight: HighlightWithBook) => {
    removeHighlight(highlight.id);
  };

  const startEditNote = (highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  };

  const saveNote = (id: string) => {
    updateHighlight(id, { note: editNote || undefined });
    setEditingId(null);
    setEditNote("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNote("");
  };

  const doExport = (
    format: ExportFormat,
    book: { id: string; meta: { title: string } },
    content: string,
  ) => {
    try {
      if (format === "notion") {
        annotationExporter.copyToClipboard(content);
        toast.success(t("notes.copiedToClipboard"));
      } else {
        const ext = format === "json" ? "json" : "md";
        annotationExporter.downloadAsFile(content, `${book.meta.title}-${format}.${ext}`, format);
        toast.success(t("notes.exportSuccess"), {
          description: `${book.meta.title}.${ext}`,
        });
      }
    } catch (error) {
      toast.error(t("notes.exportFailed"));
      console.error("Export failed:", error);
    }
  };

  const handleSingleBookExport = (format: ExportFormat) => {
    if (!selectedBook) return;
    const book = books.find((b) => b.id === selectedBook.bookId);
    if (!book) return;
    const content = annotationExporter.export(
      selectedBook.highlights as Highlight[],
      [] as Note[],
      book,
      { format },
    );
    doExport(format, book, content);
  };

  const handleMultiBookExport = (format: ExportFormat) => {
    const booksData = bookNotebooks
      .map((notebook) => {
        const book = books.find((b) => b.id === notebook.bookId);
        if (!book) return null;
        return { book, highlights: notebook.highlights as Highlight[], notes: [] as Note[] };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    if (booksData.length === 0) return;
    try {
      const content = annotationExporter.exportMultipleBooks(booksData, { format });
      if (format === "notion") {
        annotationExporter.copyToClipboard(content);
        toast.success(t("notes.copiedToClipboard"));
      } else {
        const ext = format === "json" ? "json" : "md";
        annotationExporter.downloadAsFile(content, `all-annotations.${ext}`, format);
        toast.success(t("notes.exportSuccess"), {
          description: `all-annotations.${ext}`,
        });
      }
    } catch (error) {
      toast.error(t("notes.exportFailed"));
      console.error("Export failed:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (bookNotebooks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <img src="/note.svg" alt="" className="mb-6 h-48 w-48 dark:invert" />
        <p className="text-base font-medium text-foreground">{t("notes.empty")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("notes.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel — Notebooks */}
      <div
        className={cn(
          "shrink-0 border-r border-border/40 flex flex-col",
          selectedBookId ? "w-[260px]" : "w-full",
        )}
      >
        {/* Left header */}
        <div className="shrink-0 border-b border-border/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-base font-semibold">{t("notes.title")}</h1>
                <SyncButton iconSize={14} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("notes.stats", {
                  highlights: stats?.totalHighlights || 0,
                  notes: stats?.highlightsWithNotes || 0,
                  books: stats?.totalBooks || 0,
                })}
              </p>
            </div>
            {!selectedBookId && <ExportDropdown onExport={handleMultiBookExport} />}
          </div>
        </div>

        {/* Notebook list */}
        <div className="flex-1 overflow-y-auto p-3">
          {selectedBookId ? (
            <div className="space-y-1">
              {bookNotebooks.map((book) => (
                <button
                  key={book.bookId}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    book.bookId === selectedBookId
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/60 text-foreground",
                  )}
                  onClick={() => {
                    setSelectedBookId(book.bookId);
                    setSearchQuery("");
                    setEditingId(null);
                  }}
                >
                  <CoverImage
                    url={book.coverUrl}
                    alt=""
                    className="h-9 w-6 shrink-0 rounded object-cover"
                    fallback={
                      <div className="flex h-9 w-6 shrink-0 items-center justify-center rounded bg-muted">
                        <BookOpen className="h-3 w-3 text-muted-foreground" />
                      </div>
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{book.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {book.highlights.length} {t("notes.highlightsCount")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Grid view — BookCard-inspired style */
            <div className="grid grid-cols-3 gap-x-5 gap-y-6 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {bookNotebooks.map((book) => (
                <NotebookCard
                  key={book.bookId}
                  book={book}
                  onClick={() => {
                    setSelectedBookId(book.bookId);
                    setSearchQuery("");
                    setEditingId(null);
                    setDetailTab("knowledge");
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel — Book Notes / Highlights Detail */}
      {selectedBookId && selectedBook && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Right header */}
          <div className="shrink-0 border-b border-border/40 px-5 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md p-1 hover:bg-muted transition-colors"
                onClick={() => setSelectedBookId(null)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <CoverImage
                url={selectedBook.coverUrl}
                alt=""
                className="h-10 w-7 shrink-0 rounded object-cover shadow-sm"
                fallback={
                  <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                }
              />

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold truncate">{selectedBook.title}</h2>
                <p className="text-xs text-muted-foreground">{selectedBook.author}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenBook(selectedBook.bookId, selectedBook.title)}
                  className="gap-1.5 h-7 text-xs"
                >
                  <BookOpen className="h-3 w-3" />
                  {t("notes.openBook")}
                </Button>
                <ExportDropdown onExport={handleSingleBookExport} variant="outline" size="sm" />
              </div>
            </div>

            {/* Tab switcher + search */}
            <div className="mt-3 flex items-center gap-3">
              <div className="flex rounded-lg border border-border/60 p-0.5">
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "knowledge"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDetailTab("knowledge")}
                >
                  <FileText className="h-3 w-3" />
                  {t("notes.knowledgeTab")}
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "notes"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDetailTab("notes")}
                >
                  <NotebookPen className="h-3 w-3" />
                  {t("notebook.notesSection")} ({selectedBook.notesCount})
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "highlights"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDetailTab("highlights")}
                >
                  <Highlighter className="h-3 w-3" />
                  {t("notebook.highlightsSection")} ({selectedBook.highlightsOnlyCount})
                </button>
              </div>

              {detailTab === "knowledge" ? (
                <div className="flex flex-1 items-center justify-end gap-3 text-xs text-muted-foreground">
                  <span>
                    {selectedBook.highlights.length} {t("notes.highlightsCount")}
                  </span>
                  <span>
                    {selectedBook.notesCount} {t("notes.notesCount")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Save className="h-3 w-3" />
                    {isKnowledgeSaving
                      ? t("notes.knowledgeSaving")
                      : currentKnowledgeFingerprint === savedKnowledgeFingerprint
                        ? t("notes.knowledgeSaved")
                        : t("notes.knowledgePending")}
                  </span>
                </div>
              ) : (
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t("notes.searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-8 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {detailTab === "knowledge" ? (
              <KnowledgeHomePanel
                book={selectedBook}
                document={knowledgeHome}
                value={knowledgeValue}
                isLoading={isKnowledgeLoading}
                isSaving={isKnowledgeSaving}
                isSaved={currentKnowledgeFingerprint === savedKnowledgeFingerprint}
                onChange={setKnowledgeValue}
                onOpenBook={(cfi) => handleOpenBook(selectedBook.bookId, selectedBook.title, cfi)}
                t={t}
              />
            ) : currentList.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <NotebookPen className="mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? t("notes.noSearchResults")
                    : detailTab === "notes"
                      ? t("notes.noNotes")
                      : t("highlights.noHighlights")}
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-6">
                {Array.from(itemsByChapter.entries()).map(([chapter, items]) => (
                  <div key={chapter}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-border/50" />
                      <span className="shrink-0 text-xs font-medium text-muted-foreground px-2">
                        {chapter}
                      </span>
                      <div className="h-px flex-1 bg-border/50" />
                    </div>

                    <div className="space-y-3">
                      {items.map((item) =>
                        detailTab === "notes" ? (
                          <NoteDetailCard
                            key={item.id}
                            highlight={item}
                            isEditing={editingId === item.id}
                            editNote={editNote}
                            setEditNote={setEditNote}
                            onStartEdit={() => startEditNote(item)}
                            onSaveNote={() => saveNote(item.id)}
                            onCancelEdit={cancelEdit}
                            onDeleteNote={() => handleDeleteNote(item)}
                            onNavigate={() =>
                              handleOpenBook(selectedBook.bookId, selectedBook.title, item.cfi)
                            }
                            t={t}
                          />
                        ) : (
                          <HighlightDetailCard
                            key={item.id}
                            highlight={item}
                            onDelete={() => handleDeleteHighlight(item)}
                            onNavigate={() =>
                              handleOpenBook(selectedBook.bookId, selectedBook.title, item.cfi)
                            }
                            t={t}
                          />
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Knowledge home workspace ---

interface KnowledgeHomePanelProps {
  book: {
    bookId: string;
    title: string;
    author: string;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  document: KnowledgeDocument | null;
  value: KnowledgeEditorValue;
  isLoading: boolean;
  isSaving: boolean;
  isSaved: boolean;
  onChange: (value: KnowledgeEditorValue) => void;
  onOpenBook: (cfi?: string) => void;
  t: (key: string) => string;
}

function KnowledgeHomePanel({
  book,
  document,
  value,
  isLoading,
  isSaving,
  isSaved,
  onChange,
  onOpenBook,
  t,
}: KnowledgeHomePanelProps) {
  const recentHighlights = useMemo(
    () => sortAnnotationsByPosition(book.highlights).slice(0, 4),
    [book.highlights],
  );

  if (isLoading || !document) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("notes.knowledgeLoading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-5">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_280px] gap-5">
        <section className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {t("notes.knowledgeEyebrow")}
              </p>
              <h3 className="mt-1 truncate text-lg font-semibold text-foreground">{book.title}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
              <Save className="h-3.5 w-3.5" />
              {isSaving
                ? t("notes.knowledgeSaving")
                : isSaved
                  ? t("notes.knowledgeSaved")
                  : t("notes.knowledgePending")}
            </div>
          </div>

          <KnowledgeEditor
            value={value}
            onChange={onChange}
            placeholder={t("notes.knowledgePlaceholder")}
            className="border-border/70 bg-card shadow-sm"
            contentClassName="max-h-none min-h-[520px] px-6 py-5 [&_.ProseMirror]:min-h-[480px]"
          />
        </section>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-semibold text-foreground">{t("notes.knowledgeSignals")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-lg font-semibold text-foreground">{book.notesCount}</p>
                <p className="text-[11px] text-muted-foreground">{t("notes.notesCount")}</p>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <p className="text-lg font-semibold text-foreground">{book.highlightsOnlyCount}</p>
                <p className="text-[11px] text-muted-foreground">{t("notes.highlightsCount")}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">{t("notes.knowledgeSources")}</p>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onOpenBook()}
              >
                {t("notes.openBook")}
              </button>
            </div>

            {recentHighlights.length === 0 ? (
              <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
                {t("notes.knowledgeNoSources")}
              </p>
            ) : (
              <div className="space-y-2">
                {recentHighlights.map((highlight) => (
                  <button
                    key={highlight.id}
                    type="button"
                    className="w-full rounded-md border border-border/40 bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                    onClick={() => onOpenBook(highlight.cfi)}
                  >
                    <p className="line-clamp-3 text-xs leading-relaxed text-foreground/90">
                      "{highlight.text}"
                    </p>
                    {highlight.chapterTitle && (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {highlight.chapterTitle}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// --- Notebook card (BookCard-inspired style) ---

interface NotebookCardProps {
  book: {
    bookId: string;
    title: string;
    author: string;
    coverUrl: string | null;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  onClick: () => void;
}

function NotebookCard({ book, onClick }: NotebookCardProps) {
  return (
    <button
      type="button"
      className="group flex h-full cursor-pointer flex-col justify-end text-left"
      onClick={onClick}
    >
      {/* Cover — same aspect ratio and shadow as BookCard */}
      <div className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded transition-all duration-200">
        <CoverImage
          url={book.coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full rounded object-cover"
          loading="lazy"
          fallback={
            <div className="absolute inset-0 flex flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-3">
              <div className="flex flex-1 items-center justify-center">
                <span className="line-clamp-3 text-center font-serif text-base font-medium leading-snug text-stone-500">
                  {book.title}
                </span>
              </div>
              <div className="h-px w-8 bg-stone-300/60" />
              {book.author && (
                <div className="flex h-1/4 items-center justify-center">
                  <span className="line-clamp-1 text-center font-serif text-xs text-stone-400">
                    {book.author}
                  </span>
                </div>
              )}
            </div>
          }
        />

        {/* Spine overlay */}
        {book.coverUrl && <div className="book-spine absolute inset-0 rounded" />}

        {/* Count badge — top right, shows total highlights + notes */}
        <div className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
          <Highlighter className="h-2.5 w-2.5 text-white/80" />
          <span className="text-[9px] font-medium text-white">{book.highlightsOnlyCount}</span>
          {book.notesCount > 0 && (
            <>
              <NotebookPen className="ml-0.5 h-2.5 w-2.5 text-white/80" />
              <span className="text-[9px] font-medium text-white">{book.notesCount}</span>
            </>
          )}
        </div>
      </div>

      {/* Info area — only book title, no counts */}
      <div className="flex w-full flex-col pt-2">
        <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
          {book.title}
        </h4>
      </div>
    </button>
  );
}

// --- Note detail card (for "Notes" tab) ---

interface NoteDetailCardProps {
  highlight: HighlightWithBook;
  isEditing: boolean;
  editNote: string;
  setEditNote: (note: string) => void;
  onStartEdit: () => void;
  onSaveNote: () => void;
  onCancelEdit: () => void;
  onDeleteNote: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function NoteDetailCard({
  highlight,
  isEditing,
  editNote,
  setEditNote,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onDeleteNote,
  onNavigate,
  t,
}: NoteDetailCardProps) {
  return (
    <div className="group rounded-lg border border-border/40 bg-card transition-colors hover:border-border/70">
      <div className="p-3">
        {/* Quoted highlight text */}
        <button
          type="button"
          className="line-clamp-2 cursor-pointer text-left text-xs leading-relaxed text-muted-foreground/80 transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          "{highlight.text}"
        </button>

        {/* Note content */}
        {isEditing ? (
          <div className="mt-2 flex items-start gap-2">
            <MarkdownEditor
              value={editNote}
              onChange={setEditNote}
              placeholder={t("notebook.addNote")}
              className="flex-1"
              autoFocus
            />
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="rounded p-1.5 text-primary hover:bg-primary/10"
                onClick={onSaveNote}
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                onClick={onCancelEdit}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mt-2 block w-full cursor-pointer text-left"
            onClick={onStartEdit}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed break-words overflow-hidden [overflow-wrap:anywhere]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{highlight.note || ""}</ReactMarkdown>
            </div>
          </button>
        )}

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={onStartEdit}
              title={t("notebook.editNote")}
            >
              <Edit3 className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteNote();
              }}
              title={t("notebook.deleteNote")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Highlight detail card (for "Highlights" tab) ---

interface HighlightDetailCardProps {
  highlight: HighlightWithBook;
  onDelete: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function HighlightDetailCard({ highlight, onDelete, onNavigate, t }: HighlightDetailCardProps) {
  const hexColor =
    HIGHLIGHT_COLOR_HEX[highlight.color as keyof typeof HIGHLIGHT_COLOR_HEX] ||
    HIGHLIGHT_COLOR_HEX.yellow;

  return (
    <div className="group relative rounded-lg border border-border/40 bg-card transition-colors hover:border-border/70">
      {/* Color bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ backgroundColor: hexColor }}
      />

      <div className="pl-4 pr-3 py-3">
        <button
          type="button"
          className="cursor-pointer text-left text-sm leading-relaxed text-foreground/90 transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          "{highlight.text}"
        </button>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title={t("notebook.deleteHighlight")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
