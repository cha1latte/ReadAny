import { KnowledgeEditor, type KnowledgeEditorValue } from "@/components/knowledge/KnowledgeEditor";
import { SyncButton } from "@/components/ui/SyncButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { useResolvedSrc, useSyncVersion } from "@/hooks/use-resolved-src";
import type { HighlightWithBook, KnowledgeBacklink } from "@/lib/db/database";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  ensureBookHomeDocument,
  ensureHighlightNoteKnowledgeDocuments,
  ensureNoteKnowledgeDocuments,
  getBook as getBookRecord,
  getKnowledgeAttachments,
  getKnowledgeBacklinks,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  updateKnowledgeDocument,
} from "@/lib/db/database";
import { openDesktopBook } from "@/lib/library/open-book";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore } from "@/stores/settings-store";
import { maybeCompressAndPersistKnowledgeSummary } from "@readany/core/ai";
import {
  type ExportFormat,
  type KnowledgeExportFile,
  type KnowledgeExportFormat,
  type KnowledgeExportManifest,
  type KnowledgeExportObservedFile,
  type KnowledgeImportWriteProposal,
  type KnowledgeVaultImportPlan,
  annotationExporter,
  createKnowledgeImportWriteProposal,
  createKnowledgeVaultImportPlan,
  createKnowledgeVaultImportWriteProposals,
  knowledgeExporter,
  parseKnowledgeMarkdownDocument,
} from "@readany/core/export";
import {
  createKnowledgeExcerpt,
  createKnowledgeSummarySourceFingerprint,
  getKnowledgeEditorSurfaceForDocumentType,
  knowledgeDocumentFingerprint,
  markdownToBasicTiptap,
  orderKnowledgeDocuments,
  renderKnowledgeJsonToMarkdown,
} from "@readany/core/knowledge";
import {
  type KnowledgeDocumentUpdateProposal,
  applyKnowledgeWriteProposal,
} from "@readany/core/knowledge/proposals";
import { sortAnnotationsByPosition } from "@readany/core/reader";
import type {
  Book,
  Highlight,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
  Note,
} from "@readany/core/types";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { cn, providerRequiresApiKey } from "@readany/core/utils";
import { eventBus } from "@readany/core/utils/event-bus";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  Download,
  Edit3,
  FileText,
  FolderDown,
  FolderUp,
  Highlighter,
  Link2,
  NotebookPen,
  Plus,
  Save,
  Search,
  Sparkles,
  Tag,
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
type CreatableKnowledgeDocumentType = Extract<
  KnowledgeDocumentType,
  "standalone_note" | "review" | "summary"
>;

interface KnowledgeVaultConflictNotice {
  rootPath: string;
  paths: string[];
  kind: "external_modified" | "untracked_existing_file";
}

interface KnowledgeVaultImportReview {
  rootPath: string;
  plan: KnowledgeVaultImportPlan;
  proposals: KnowledgeDocumentUpdateProposal[];
}

interface KnowledgeMarkdownImportReviewItem {
  path: string;
  proposal: KnowledgeImportWriteProposal;
  warnings: string[];
}

interface KnowledgeMarkdownImportReview {
  items: KnowledgeMarkdownImportReviewItem[];
}

function createEmptyKnowledgeValue(): KnowledgeEditorValue {
  return {
    contentJson: { type: "doc", content: [] },
    contentMd: "",
    plainText: "",
  };
}

function normalizeKnowledgeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function canDeleteKnowledgeDocument(document: KnowledgeDocument): boolean {
  if (document.type === "book_home") return false;
  if (document.sourceKind === "highlight" || document.sourceKind === "note") return false;
  return true;
}

function knowledgeDocumentCreateTitle(
  type: CreatableKnowledgeDocumentType,
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (type === "review") return t("notes.knowledgeNewReviewTitle", { count });
  if (type === "summary") return t("notes.knowledgeNewSummaryTitle", { count });
  return t("notes.knowledgeNewNoteTitle", { count });
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

function normalizeExportPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");
}

function exportFileDirectory(path: string): string | null {
  const normalized = normalizeExportPath(path);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

function uniqueExportPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizeExportPath))).filter(Boolean);
}

function desktopFileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

async function joinDesktopPath(rootPath: string, relativePath: string): Promise<string> {
  const { join } = await import("@tauri-apps/api/path");
  const parts = normalizeExportPath(relativePath).split("/").filter(Boolean);
  return join(rootPath, ...parts);
}

async function readKnowledgeVaultManifest(
  rootPath: string,
): Promise<KnowledgeExportManifest | undefined> {
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const manifestPath = await joinDesktopPath(rootPath, ".readany/manifest.json");
  if (!(await exists(manifestPath))) return undefined;

  const raw = await readTextFile(manifestPath);
  return JSON.parse(raw) as KnowledgeExportManifest;
}

async function readExistingKnowledgeVaultFiles(
  rootPath: string,
  paths: string[],
): Promise<KnowledgeExportObservedFile[]> {
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const existingFiles: KnowledgeExportObservedFile[] = [];

  for (const path of uniqueExportPaths(paths)) {
    const filePath = await joinDesktopPath(rootPath, path);
    if (!(await exists(filePath))) continue;
    try {
      existingFiles.push({
        path,
        content: await readTextFile(filePath),
      });
    } catch {
      existingFiles.push({ path });
    }
  }

  return existingFiles;
}

async function writeKnowledgeVaultFiles(
  rootPath: string,
  files: KnowledgeExportFile[],
): Promise<void> {
  const { copyFile, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");

  for (const file of files) {
    const directory = exportFileDirectory(file.path);
    if (directory) {
      await mkdir(await joinDesktopPath(rootPath, directory), { recursive: true });
    }
    const targetPath = await joinDesktopPath(rootPath, file.path);
    if (file.sourcePath) {
      await copyFile(file.sourcePath, targetPath);
    } else {
      await writeTextFile(targetPath, file.content);
    }
  }
}

async function collectKnowledgeVaultInput(liveDocument: KnowledgeDocument, books: Book[]) {
  const documents = await getKnowledgeDocuments({ limit: 5000 });
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  documentMap.set(liveDocument.id, liveDocument);
  const mergedDocuments = Array.from(documentMap.values());

  const [linksByDocument, attachmentsByDocument] = await Promise.all([
    Promise.all(mergedDocuments.map((document) => getKnowledgeLinks(document.id))),
    Promise.all(mergedDocuments.map((document) => getKnowledgeAttachments(document.id))),
  ]);

  return {
    documents: mergedDocuments,
    books,
    links: linksByDocument.flat(),
    attachments: attachmentsByDocument.flat(),
  };
}

async function collectBookKnowledgeExportInput(
  bookId: string,
  liveDocument: KnowledgeDocument,
  book: Book,
) {
  const documents = await getKnowledgeDocuments({ bookId, limit: 500 });
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  documentMap.set(liveDocument.id, liveDocument);
  const homeDocumentId = documents.find((document) => document.type === "book_home")?.id;
  const mergedDocuments = orderKnowledgeDocuments(Array.from(documentMap.values()), homeDocumentId);

  const [linksByDocument, attachmentsByDocument] = await Promise.all([
    Promise.all(mergedDocuments.map((document) => getKnowledgeLinks(document.id))),
    Promise.all(mergedDocuments.map((document) => getKnowledgeAttachments(document.id))),
  ]);

  return {
    documents: mergedDocuments,
    books: [book],
    links: linksByDocument.flat(),
    attachments: attachmentsByDocument.flat(),
  };
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
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("knowledge");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [knowledgeHome, setKnowledgeHome] = useState<KnowledgeDocument | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedKnowledgeDocumentId, setSelectedKnowledgeDocumentId] = useState<string | null>(
    null,
  );
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeTags, setKnowledgeTags] = useState<string[]>([]);
  const [knowledgeValue, setKnowledgeValue] =
    useState<KnowledgeEditorValue>(createEmptyKnowledgeValue);
  const [savedKnowledgeFingerprint, setSavedKnowledgeFingerprint] = useState(
    knowledgeDocumentFingerprint("", createEmptyKnowledgeValue()),
  );
  const [knowledgeLinks, setKnowledgeLinks] = useState<KnowledgeLink[]>([]);
  const [knowledgeBacklinks, setKnowledgeBacklinks] = useState<KnowledgeBacklink[]>([]);
  const [isKnowledgeRelationsLoading, setIsKnowledgeRelationsLoading] = useState(false);
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);
  const [isKnowledgeSaving, setIsKnowledgeSaving] = useState(false);
  const [isKnowledgeSummaryCompressing, setIsKnowledgeSummaryCompressing] = useState(false);
  const [isKnowledgeDocumentCreating, setIsKnowledgeDocumentCreating] = useState(false);
  const [isKnowledgeMarkdownImporting, setIsKnowledgeMarkdownImporting] = useState(false);
  const [isKnowledgeMarkdownImportApplying, setIsKnowledgeMarkdownImportApplying] = useState(false);
  const [isKnowledgeVaultExporting, setIsKnowledgeVaultExporting] = useState(false);
  const [isKnowledgeVaultImporting, setIsKnowledgeVaultImporting] = useState(false);
  const [isKnowledgeVaultImportApplying, setIsKnowledgeVaultImportApplying] = useState(false);
  const [knowledgeVaultConflicts, setKnowledgeVaultConflicts] =
    useState<KnowledgeVaultConflictNotice | null>(null);
  const [knowledgeMarkdownImportReview, setKnowledgeMarkdownImportReview] =
    useState<KnowledgeMarkdownImportReview | null>(null);
  const [knowledgeVaultImportReview, setKnowledgeVaultImportReview] =
    useState<KnowledgeVaultImportReview | null>(null);
  const knowledgeSaveVersionRef = useRef(0);
  const currentKnowledgeFingerprint = useMemo(
    () => knowledgeDocumentFingerprint(knowledgeTitle, knowledgeValue, knowledgeTags),
    [knowledgeTitle, knowledgeTags, knowledgeValue],
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
  const activeKnowledgeDocumentId = knowledgeHome?.id ?? null;

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
        setKnowledgeDocuments([]);
        setSelectedKnowledgeDocumentId(null);
        setKnowledgeTitle("");
        setKnowledgeTags([]);
        const emptyValue = createEmptyKnowledgeValue();
        setKnowledgeValue(emptyValue);
        setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
        setIsKnowledgeSaving(false);
        setKnowledgeLinks([]);
        setKnowledgeBacklinks([]);
        return;
      }

      setIsKnowledgeLoading(true);
      setIsKnowledgeSaving(false);
      try {
        const homeDocument = await ensureBookHomeDocument(
          selectedKnowledgeBookId,
          selectedKnowledgeBookTitle,
        );
        await Promise.all([
          ensureHighlightNoteKnowledgeDocuments(selectedKnowledgeBookId),
          ensureNoteKnowledgeDocuments(selectedKnowledgeBookId),
        ]);
        const bookDocuments = await getKnowledgeDocuments({
          bookId: selectedKnowledgeBookId,
          limit: 200,
        });
        if (cancelled) return;
        const nextDocuments = orderKnowledgeDocuments(
          [homeDocument, ...bookDocuments],
          homeDocument.id,
        );
        const activeDocument = nextDocuments[0] ?? homeDocument;
        const nextValue = createKnowledgeValueFromDocument(activeDocument);
        setKnowledgeDocuments(nextDocuments);
        setSelectedKnowledgeDocumentId(activeDocument.id);
        setKnowledgeHome(activeDocument);
        setKnowledgeTitle(activeDocument.title);
        setKnowledgeTags(normalizeKnowledgeTags(activeDocument.tags));
        setKnowledgeValue(nextValue);
        setSavedKnowledgeFingerprint(
          knowledgeDocumentFingerprint(activeDocument.title, nextValue, activeDocument.tags),
        );
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
    let cancelled = false;

    async function loadKnowledgeRelations() {
      if (!activeKnowledgeDocumentId) {
        setKnowledgeLinks([]);
        setKnowledgeBacklinks([]);
        setIsKnowledgeRelationsLoading(false);
        return;
      }

      setIsKnowledgeRelationsLoading(true);
      try {
        const [links, backlinks] = await Promise.all([
          getKnowledgeLinks(activeKnowledgeDocumentId),
          getKnowledgeBacklinks(activeKnowledgeDocumentId),
        ]);
        if (cancelled) return;
        setKnowledgeLinks(links);
        setKnowledgeBacklinks(backlinks);
      } catch (error) {
        if (cancelled) return;
        console.error("[Notes] Failed to load knowledge relations:", error);
        setKnowledgeLinks([]);
        setKnowledgeBacklinks([]);
      } finally {
        if (!cancelled) setIsKnowledgeRelationsLoading(false);
      }
    }

    void loadKnowledgeRelations();

    return () => {
      cancelled = true;
    };
  }, [activeKnowledgeDocumentId]);

  useEffect(() => {
    if (!knowledgeHome || currentKnowledgeFingerprint === savedKnowledgeFingerprint) return;

    const saveVersion = knowledgeSaveVersionRef.current + 1;
    knowledgeSaveVersionRef.current = saveVersion;
    const normalizedTitle = knowledgeTitle.trim() || knowledgeHome.title;
    const normalizedTags = normalizeKnowledgeTags(knowledgeTags);
    const nextExcerpt = createKnowledgeExcerpt(knowledgeValue.contentMd);

    const timeout = window.setTimeout(async () => {
      if (knowledgeSaveVersionRef.current !== saveVersion) return;
      setIsKnowledgeSaving(true);
      try {
        await updateKnowledgeDocument(knowledgeHome.id, {
          title: normalizedTitle,
          contentMd: knowledgeValue.contentMd,
          contentJson: knowledgeValue.contentJson,
          excerpt: nextExcerpt,
          tags: normalizedTags,
        });
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        const updatedDocument: KnowledgeDocument = {
          ...knowledgeHome,
          title: normalizedTitle,
          contentMd: knowledgeValue.contentMd,
          contentJson: knowledgeValue.contentJson,
          excerpt: nextExcerpt,
          tags: normalizedTags,
          updatedAt: Date.now(),
        };
        setKnowledgeHome(updatedDocument);
        setKnowledgeDocuments((documents) =>
          orderKnowledgeDocuments(
            documents.map((document) =>
              document.id === updatedDocument.id ? updatedDocument : document,
            ),
            documents.find((document) => document.type === "book_home")?.id,
          ),
        );
        if (normalizedTitle !== knowledgeTitle) setKnowledgeTitle(normalizedTitle);
        if (normalizedTags.join("\u0000") !== knowledgeTags.join("\u0000")) {
          setKnowledgeTags(normalizedTags);
        }
        setSavedKnowledgeFingerprint(
          knowledgeDocumentFingerprint(normalizedTitle, knowledgeValue, normalizedTags),
        );
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
  }, [
    knowledgeHome,
    knowledgeTitle,
    knowledgeTags,
    knowledgeValue,
    currentKnowledgeFingerprint,
    savedKnowledgeFingerprint,
    t,
  ]);

  const saveActiveKnowledgeDocumentNow = async (): Promise<boolean> => {
    if (!knowledgeHome || currentKnowledgeFingerprint === savedKnowledgeFingerprint) return true;

    const saveVersion = knowledgeSaveVersionRef.current + 1;
    knowledgeSaveVersionRef.current = saveVersion;
    const normalizedTitle = knowledgeTitle.trim() || knowledgeHome.title;
    const normalizedTags = normalizeKnowledgeTags(knowledgeTags);
    const nextExcerpt = createKnowledgeExcerpt(knowledgeValue.contentMd);

    setIsKnowledgeSaving(true);
    try {
      await updateKnowledgeDocument(knowledgeHome.id, {
        title: normalizedTitle,
        contentMd: knowledgeValue.contentMd,
        contentJson: knowledgeValue.contentJson,
        excerpt: nextExcerpt,
        tags: normalizedTags,
      });
      if (knowledgeSaveVersionRef.current !== saveVersion) return false;
      const updatedDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: normalizedTitle,
        contentMd: knowledgeValue.contentMd,
        contentJson: knowledgeValue.contentJson,
        excerpt: nextExcerpt,
        tags: normalizedTags,
        updatedAt: Date.now(),
      };
      setKnowledgeHome(updatedDocument);
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          documents.map((document) =>
            document.id === updatedDocument.id ? updatedDocument : document,
          ),
          documents.find((document) => document.type === "book_home")?.id,
        ),
      );
      if (normalizedTitle !== knowledgeTitle) setKnowledgeTitle(normalizedTitle);
      if (normalizedTags.join("\u0000") !== knowledgeTags.join("\u0000")) {
        setKnowledgeTags(normalizedTags);
      }
      setSavedKnowledgeFingerprint(
        knowledgeDocumentFingerprint(normalizedTitle, knowledgeValue, normalizedTags),
      );
      return true;
    } catch (error) {
      if (knowledgeSaveVersionRef.current === saveVersion) {
        console.error("[Notes] Failed to save knowledge document:", error);
        toast.error(t("notes.knowledgeSaveFailed"));
      }
      return false;
    } finally {
      if (knowledgeSaveVersionRef.current === saveVersion) {
        setIsKnowledgeSaving(false);
      }
    }
  };

  const openKnowledgeDocument = async (document: KnowledgeDocument) => {
    if (document.id === knowledgeHome?.id) return;
    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    knowledgeSaveVersionRef.current += 1;
    const nextValue = createKnowledgeValueFromDocument(document);
    setSelectedKnowledgeDocumentId(document.id);
    setKnowledgeHome(document);
    setKnowledgeTitle(document.title);
    setKnowledgeTags(normalizeKnowledgeTags(document.tags));
    setKnowledgeValue(nextValue);
    setSavedKnowledgeFingerprint(
      knowledgeDocumentFingerprint(document.title, nextValue, document.tags),
    );
    setIsKnowledgeSaving(false);
  };

  const refreshSelectedKnowledgeDocuments = async (preferredDocumentId?: string | null) => {
    if (!selectedKnowledgeBookId) return;

    const homeDocument = await ensureBookHomeDocument(
      selectedKnowledgeBookId,
      selectedKnowledgeBookTitle,
    );
    const bookDocuments = await getKnowledgeDocuments({
      bookId: selectedKnowledgeBookId,
      limit: 200,
    });
    const documentsById = new Map<string, KnowledgeDocument>();
    for (const document of [homeDocument, ...bookDocuments]) {
      documentsById.set(document.id, document);
    }
    const nextDocuments = orderKnowledgeDocuments(
      Array.from(documentsById.values()),
      homeDocument.id,
    );
    const nextActiveDocument =
      nextDocuments.find((document) => document.id === preferredDocumentId) ??
      nextDocuments.find((document) => document.id === knowledgeHome?.id) ??
      nextDocuments[0] ??
      null;

    knowledgeSaveVersionRef.current += 1;
    setKnowledgeDocuments(nextDocuments);

    if (!nextActiveDocument) {
      setSelectedKnowledgeDocumentId(null);
      setKnowledgeHome(null);
      setKnowledgeTitle("");
      setKnowledgeTags([]);
      const emptyValue = createEmptyKnowledgeValue();
      setKnowledgeValue(emptyValue);
      setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
      setIsKnowledgeSaving(false);
      return;
    }

    const nextValue = createKnowledgeValueFromDocument(nextActiveDocument);
    setSelectedKnowledgeDocumentId(nextActiveDocument.id);
    setKnowledgeHome(nextActiveDocument);
    setKnowledgeTitle(nextActiveDocument.title);
    setKnowledgeTags(normalizeKnowledgeTags(nextActiveDocument.tags));
    setKnowledgeValue(nextValue);
    setSavedKnowledgeFingerprint(
      knowledgeDocumentFingerprint(nextActiveDocument.title, nextValue, nextActiveDocument.tags),
    );
    setIsKnowledgeSaving(false);
  };

  const handleCreateKnowledgeDocument = async (
    type: CreatableKnowledgeDocumentType = "standalone_note",
  ) => {
    if (!selectedKnowledgeBookId || isKnowledgeDocumentCreating) return;
    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    setIsKnowledgeDocumentCreating(true);
    try {
      const count = Math.max(
        1,
        knowledgeDocuments.filter((document) => document.type === type).length + 1,
      );
      const document = await createKnowledgeDocument({
        bookId: selectedKnowledgeBookId,
        type,
        title: knowledgeDocumentCreateTitle(type, count, t),
        contentJson: createEmptyKnowledgeValue().contentJson,
        contentMd: "",
        excerpt: undefined,
        tags: [],
        sourceKind: "book",
        sourceId: selectedKnowledgeBookId,
      });
      const nextValue = createKnowledgeValueFromDocument(document);
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          [document, ...documents],
          documents.find((item) => item.type === "book_home")?.id,
        ),
      );
      setSelectedKnowledgeDocumentId(document.id);
      setKnowledgeHome(document);
      setKnowledgeTitle(document.title);
      setKnowledgeTags([]);
      setKnowledgeValue(nextValue);
      setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint(document.title, nextValue, []));
      toast.success(t("notes.knowledgeDocumentCreated"));
    } catch (error) {
      console.error("[Notes] Failed to create knowledge document:", error);
      toast.error(t("notes.knowledgeDocumentCreateFailed"));
    } finally {
      setIsKnowledgeDocumentCreating(false);
    }
  };

  const handleDeleteKnowledgeDocument = async (document: KnowledgeDocument) => {
    if (!canDeleteKnowledgeDocument(document)) {
      toast.error(t("notes.knowledgeDocumentDeleteBlocked"));
      return;
    }

    if (!window.confirm(t("notes.knowledgeDocumentDeleteConfirm", { title: document.title }))) {
      return;
    }

    const isDeletingActiveDocument = document.id === knowledgeHome?.id;
    if (isDeletingActiveDocument) {
      knowledgeSaveVersionRef.current += 1;
    }

    try {
      await deleteKnowledgeDocument(document.id);
      const remainingDocuments = orderKnowledgeDocuments(
        knowledgeDocuments.filter((item) => item.id !== document.id),
        knowledgeDocuments.find((item) => item.type === "book_home")?.id,
      );
      setKnowledgeDocuments(remainingDocuments);

      if (isDeletingActiveDocument) {
        const nextDocument =
          remainingDocuments.find((item) => item.type === "book_home") ??
          remainingDocuments[0] ??
          null;
        if (nextDocument) {
          const nextValue = createKnowledgeValueFromDocument(nextDocument);
          setSelectedKnowledgeDocumentId(nextDocument.id);
          setKnowledgeHome(nextDocument);
          setKnowledgeTitle(nextDocument.title);
          setKnowledgeTags(normalizeKnowledgeTags(nextDocument.tags));
          setKnowledgeValue(nextValue);
          setSavedKnowledgeFingerprint(
            knowledgeDocumentFingerprint(nextDocument.title, nextValue, nextDocument.tags),
          );
        } else {
          setSelectedKnowledgeDocumentId(null);
          setKnowledgeHome(null);
          setKnowledgeTitle("");
          setKnowledgeTags([]);
          const emptyValue = createEmptyKnowledgeValue();
          setKnowledgeValue(emptyValue);
          setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
        }
        setIsKnowledgeSaving(false);
      } else if (selectedKnowledgeDocumentId === document.id) {
        setSelectedKnowledgeDocumentId(knowledgeHome?.id ?? null);
      }

      toast.success(t("notes.knowledgeDocumentDeleted"));
    } catch (error) {
      console.error("[Notes] Failed to delete knowledge document:", error);
      toast.error(t("notes.knowledgeDocumentDeleteFailed"));
    }
  };

  const handleCompressKnowledgeSummary = async () => {
    if (!knowledgeHome || isKnowledgeSummaryCompressing) return;

    const endpoint = aiConfig.endpoints.find((item) => item.id === aiConfig.activeEndpointId);
    const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
    if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) {
      toast.error(t("notes.knowledgeSummaryAIConfigMissing"));
      return;
    }

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    const liveDocument: KnowledgeDocument = {
      ...knowledgeHome,
      title: knowledgeTitle.trim() || knowledgeHome.title,
      contentJson: knowledgeValue.contentJson,
      contentMd: knowledgeValue.contentMd,
      excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
      tags: normalizeKnowledgeTags(knowledgeTags),
      updatedAt: Date.now(),
    };

    setIsKnowledgeSummaryCompressing(true);
    try {
      const result = await maybeCompressAndPersistKnowledgeSummary(liveDocument, aiConfig);
      if (result.status === "failed") {
        toast.error(t("notes.knowledgeSummaryFailed"), {
          description: result.error,
        });
        return;
      }

      if (result.status === "skipped") {
        const message =
          result.plan.reason === "empty"
            ? t("notes.knowledgeSummaryEmpty")
            : result.plan.reason === "below_threshold"
              ? t("notes.knowledgeSummaryTooShort")
              : t("notes.knowledgeSummaryUpToDate");
        toast.success(message);
        return;
      }

      const refreshedDocument = await getKnowledgeDocument(liveDocument.id);
      const updatedDocument: KnowledgeDocument =
        refreshedDocument ??
        ({
          ...liveDocument,
          summaryMd: result.state?.summaryMd,
          summarySourceFingerprint: result.state?.sourceFingerprint,
          summarySourceUpdatedAt: result.state?.sourceUpdatedAt,
          summaryUpdatedAt: result.state?.compressedAt,
          updatedAt: Date.now(),
        } satisfies KnowledgeDocument);

      setKnowledgeHome(updatedDocument);
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          documents.map((document) =>
            document.id === updatedDocument.id ? updatedDocument : document,
          ),
          documents.find((document) => document.type === "book_home")?.id,
        ),
      );
      toast.success(t("notes.knowledgeSummaryCompressed"));
    } catch (error) {
      console.error("[Notes] Failed to compress knowledge summary:", error);
      toast.error(t("notes.knowledgeSummaryFailed"));
    } finally {
      setIsKnowledgeSummaryCompressing(false);
    }
  };

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

  const handleKnowledgeExport = async (format: KnowledgeExportFormat) => {
    if (!selectedBook || !knowledgeHome) return;
    const book = books.find((b) => b.id === selectedBook.bookId);
    if (!book) return;

    try {
      const liveDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: knowledgeTitle.trim() || knowledgeHome.title,
        contentJson: knowledgeValue.contentJson,
        contentMd: knowledgeValue.contentMd,
        excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
        tags: normalizeKnowledgeTags(knowledgeTags),
        updatedAt: Date.now(),
      };
      const input = await collectBookKnowledgeExportInput(selectedBook.bookId, liveDocument, book);
      const file = knowledgeExporter.exportBundle(input, {
        format,
        rootDir: "ReadAny",
        title: `${selectedBook.title} Knowledge`,
      });

      const filename =
        file.path.split("/").filter(Boolean).pop() || `${book.meta.title}-knowledge.md`;
      await annotationExporter.downloadAsFile(file.content, filename, format);
      toast.success(t("notes.exportSuccess"), {
        description: file.path,
      });
    } catch (error) {
      toast.error(t("notes.exportFailed"));
      console.error("[Notes] Knowledge export failed:", error);
    }
  };

  const handleKnowledgeVaultExport = async () => {
    if (!selectedBook || !knowledgeHome || isKnowledgeVaultExporting) return;

    setIsKnowledgeVaultExporting(true);
    setKnowledgeVaultConflicts(null);
    setKnowledgeMarkdownImportReview(null);
    setKnowledgeVaultImportReview(null);

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("notes.knowledgeVaultSelectFolder"),
      });
      if (!selected || Array.isArray(selected)) return;

      const liveDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: knowledgeTitle.trim() || knowledgeHome.title,
        contentJson: knowledgeValue.contentJson,
        contentMd: knowledgeValue.contentMd,
        excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
        tags: normalizeKnowledgeTags(knowledgeTags),
        updatedAt: Date.now(),
      };
      const input = await collectKnowledgeVaultInput(liveDocument, books);

      let previousManifest: KnowledgeExportManifest | undefined;
      try {
        previousManifest = await readKnowledgeVaultManifest(selected);
      } catch (error) {
        toast.error(t("notes.knowledgeVaultManifestInvalid"));
        console.error("[Notes] Failed to read knowledge vault manifest:", error);
        return;
      }

      const draftPackage = knowledgeExporter.buildVaultPackage(input, {
        format: "obsidian",
        rootDir: "",
        previousManifest,
      });
      const existingFiles = await readExistingKnowledgeVaultFiles(
        selected,
        previousManifest
          ? [
              ...Object.values(previousManifest.documents).map((entry) => entry.path),
              ...Object.values(draftPackage.manifest.documents).map((entry) => entry.path),
            ]
          : draftPackage.files.map((file) => file.path),
      );

      if (!previousManifest && existingFiles.length > 0) {
        const paths = existingFiles.map((file) => file.path);
        setKnowledgeVaultConflicts({
          rootPath: selected,
          paths,
          kind: "untracked_existing_file",
        });
        toast.error(t("notes.knowledgeVaultConflictToast"));
        return;
      }

      const vaultPackage = knowledgeExporter.buildVaultPackage(input, {
        format: "obsidian",
        rootDir: "",
        previousManifest,
        existingFiles,
      });

      if (vaultPackage.conflicts.length > 0) {
        setKnowledgeVaultConflicts({
          rootPath: selected,
          paths: vaultPackage.conflicts.map((conflict) => conflict.path),
          kind: "external_modified",
        });
        toast.error(t("notes.knowledgeVaultConflictToast"));
        return;
      }

      await writeKnowledgeVaultFiles(selected, vaultPackage.files);
      toast.success(t("notes.knowledgeVaultExportSuccess"), {
        description: t("notes.knowledgeVaultExportSuccessDetail", {
          count: vaultPackage.files.length,
        }),
      });
    } catch (error) {
      toast.error(t("notes.knowledgeVaultExportFailed"));
      console.error("[Notes] Knowledge vault export failed:", error);
    } finally {
      setIsKnowledgeVaultExporting(false);
    }
  };

  const handleKnowledgeMarkdownImport = async () => {
    if (
      !selectedKnowledgeBookId ||
      isKnowledgeMarkdownImporting ||
      isKnowledgeMarkdownImportApplying
    ) {
      return;
    }

    setIsKnowledgeMarkdownImporting(true);
    setKnowledgeVaultConflicts(null);
    setKnowledgeVaultImportReview(null);
    setKnowledgeMarkdownImportReview(null);

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        title: t("notes.knowledgeMarkdownImportSelectFiles"),
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown", "MD", "MARKDOWN"],
          },
        ],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const items: KnowledgeMarkdownImportReviewItem[] = [];
      for (const path of paths) {
        const content = await readTextFile(path);
        const imported = parseKnowledgeMarkdownDocument({
          path,
          content,
          bookId: selectedKnowledgeBookId,
        });
        items.push({
          path,
          proposal: createKnowledgeImportWriteProposal(imported, {
            message: t("notes.knowledgeMarkdownImportProposalMessage", {
              file: desktopFileName(path),
            }),
          }),
          warnings: imported.warnings,
        });
      }

      setKnowledgeMarkdownImportReview({ items });
      toast.success(t("notes.knowledgeMarkdownImportReady"), {
        description: t("notes.knowledgeMarkdownImportReadyDetail", { count: items.length }),
      });
    } catch (error) {
      toast.error(t("notes.knowledgeMarkdownImportFailed"));
      console.error("[Notes] Knowledge Markdown import failed:", error);
    } finally {
      setIsKnowledgeMarkdownImporting(false);
    }
  };

  const handleApplyKnowledgeMarkdownImport = async () => {
    if (!knowledgeMarkdownImportReview || isKnowledgeMarkdownImportApplying) return;

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    setIsKnowledgeMarkdownImportApplying(true);
    try {
      const importedDocumentIds: string[] = [];
      for (const item of knowledgeMarkdownImportReview.items) {
        const result = await applyKnowledgeWriteProposal(item.proposal);
        if (result.documentId) importedDocumentIds.push(result.documentId);
      }
      await refreshSelectedKnowledgeDocuments(importedDocumentIds[0] ?? knowledgeHome?.id);
      toast.success(t("notes.knowledgeMarkdownImportApplied"), {
        description: t("notes.knowledgeMarkdownImportAppliedDetail", {
          count: knowledgeMarkdownImportReview.items.length,
        }),
      });
      setKnowledgeMarkdownImportReview(null);
    } catch (error) {
      toast.error(t("notes.knowledgeMarkdownImportApplyFailed"));
      console.error("[Notes] Failed to apply knowledge Markdown import:", error);
    } finally {
      setIsKnowledgeMarkdownImportApplying(false);
    }
  };

  const handleKnowledgeVaultImport = async () => {
    if (isKnowledgeVaultImporting || isKnowledgeVaultImportApplying) return;

    setIsKnowledgeVaultImporting(true);
    setKnowledgeVaultConflicts(null);
    setKnowledgeMarkdownImportReview(null);
    setKnowledgeVaultImportReview(null);

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("notes.knowledgeVaultImportSelectFolder"),
      });
      if (!selected || Array.isArray(selected)) return;

      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      let manifest: KnowledgeExportManifest | undefined;
      try {
        manifest = await readKnowledgeVaultManifest(selected);
      } catch (error) {
        toast.error(t("notes.knowledgeVaultManifestInvalid"));
        console.error("[Notes] Failed to read knowledge vault manifest for import:", error);
        return;
      }

      if (!manifest) {
        toast.error(t("notes.knowledgeVaultImportManifestMissing"));
        return;
      }

      const files = await readExistingKnowledgeVaultFiles(
        selected,
        Object.values(manifest.documents).map((entry) => entry.path),
      );
      const liveDocument: KnowledgeDocument | null = knowledgeHome
        ? {
            ...knowledgeHome,
            title: knowledgeTitle.trim() || knowledgeHome.title,
            contentJson: knowledgeValue.contentJson,
            contentMd: knowledgeValue.contentMd,
            excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
            tags: normalizeKnowledgeTags(knowledgeTags),
            updatedAt: Date.now(),
          }
        : null;
      const currentFiles = liveDocument
        ? knowledgeExporter.buildVaultPackage(
            await collectKnowledgeVaultInput(liveDocument, books),
            {
              format: "obsidian",
              rootDir: "",
              previousManifest: manifest,
            },
          ).files
        : [];
      const plan = createKnowledgeVaultImportPlan({ manifest, files, currentFiles });
      const proposals = createKnowledgeVaultImportWriteProposals(plan);

      if (
        plan.modified.length === 0 &&
        plan.missing.length === 0 &&
        plan.unreadable.length === 0 &&
        plan.conflicts.length === 0
      ) {
        toast.success(t("notes.knowledgeVaultImportUpToDate"));
        return;
      }

      setKnowledgeVaultImportReview({
        rootPath: selected,
        plan,
        proposals,
      });

      if (proposals.length > 0) {
        toast.success(t("notes.knowledgeVaultImportReady"), {
          description: t("notes.knowledgeVaultImportReadyDetail", {
            count: proposals.length,
          }),
        });
      } else {
        toast.error(t("notes.knowledgeVaultImportNoApplicableChanges"));
      }
    } catch (error) {
      toast.error(t("notes.knowledgeVaultImportFailed"));
      console.error("[Notes] Knowledge vault import failed:", error);
    } finally {
      setIsKnowledgeVaultImporting(false);
    }
  };

  const handleApplyKnowledgeVaultImport = async () => {
    if (!knowledgeVaultImportReview || isKnowledgeVaultImportApplying) return;
    if (knowledgeVaultImportReview.proposals.length === 0) return;

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    setIsKnowledgeVaultImportApplying(true);
    try {
      for (const proposal of knowledgeVaultImportReview.proposals) {
        await applyKnowledgeWriteProposal(proposal);
      }
      await refreshSelectedKnowledgeDocuments(knowledgeHome?.id);
      toast.success(t("notes.knowledgeVaultImportApplied"), {
        description: t("notes.knowledgeVaultImportAppliedDetail", {
          count: knowledgeVaultImportReview.proposals.length,
        }),
      });
      setKnowledgeVaultImportReview(null);
    } catch (error) {
      toast.error(t("notes.knowledgeVaultImportApplyFailed"));
      console.error("[Notes] Failed to apply knowledge vault import:", error);
    } finally {
      setIsKnowledgeVaultImportApplying(false);
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
                documents={knowledgeDocuments}
                activeDocumentId={selectedKnowledgeDocumentId}
                title={knowledgeTitle}
                tags={knowledgeTags}
                value={knowledgeValue}
                links={knowledgeLinks}
                backlinks={knowledgeBacklinks}
                isRelationsLoading={isKnowledgeRelationsLoading}
                isLoading={isKnowledgeLoading}
                isSaving={isKnowledgeSaving}
                isSummaryCompressing={isKnowledgeSummaryCompressing}
                isCreatingDocument={isKnowledgeDocumentCreating}
                isSaved={currentKnowledgeFingerprint === savedKnowledgeFingerprint}
                onTitleChange={setKnowledgeTitle}
                onTagsChange={setKnowledgeTags}
                onChange={setKnowledgeValue}
                onSelectDocument={openKnowledgeDocument}
                onCreateDocument={handleCreateKnowledgeDocument}
                onDeleteDocument={handleDeleteKnowledgeDocument}
                onCompressSummary={handleCompressKnowledgeSummary}
                onExport={handleKnowledgeExport}
                onImportMarkdown={handleKnowledgeMarkdownImport}
                onExportVault={handleKnowledgeVaultExport}
                onImportVault={handleKnowledgeVaultImport}
                onOpenBook={(cfi) => handleOpenBook(selectedBook.bookId, selectedBook.title, cfi)}
                isMarkdownImporting={isKnowledgeMarkdownImporting}
                isMarkdownImportApplying={isKnowledgeMarkdownImportApplying}
                isVaultExporting={isKnowledgeVaultExporting}
                isVaultImporting={isKnowledgeVaultImporting}
                isVaultImportApplying={isKnowledgeVaultImportApplying}
                vaultConflicts={knowledgeVaultConflicts}
                onDismissVaultConflicts={() => setKnowledgeVaultConflicts(null)}
                markdownImportReview={knowledgeMarkdownImportReview}
                onApplyMarkdownImport={handleApplyKnowledgeMarkdownImport}
                onDismissMarkdownImport={() => setKnowledgeMarkdownImportReview(null)}
                vaultImportReview={knowledgeVaultImportReview}
                onApplyVaultImport={handleApplyKnowledgeVaultImport}
                onDismissVaultImport={() => setKnowledgeVaultImportReview(null)}
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
  documents: KnowledgeDocument[];
  activeDocumentId: string | null;
  title: string;
  tags: string[];
  value: KnowledgeEditorValue;
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  isRelationsLoading: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isSummaryCompressing: boolean;
  isCreatingDocument: boolean;
  isSaved: boolean;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string[]) => void;
  onChange: (value: KnowledgeEditorValue) => void;
  onSelectDocument: (document: KnowledgeDocument) => void;
  onCreateDocument: (type?: CreatableKnowledgeDocumentType) => void;
  onDeleteDocument: (document: KnowledgeDocument) => void;
  onCompressSummary: () => void;
  onExport: (format: KnowledgeExportFormat) => void;
  onImportMarkdown: () => void;
  onExportVault: () => void;
  onImportVault: () => void;
  onOpenBook: (cfi?: string) => void;
  isMarkdownImporting: boolean;
  isMarkdownImportApplying: boolean;
  isVaultExporting: boolean;
  isVaultImporting: boolean;
  isVaultImportApplying: boolean;
  vaultConflicts: KnowledgeVaultConflictNotice | null;
  onDismissVaultConflicts: () => void;
  markdownImportReview: KnowledgeMarkdownImportReview | null;
  onApplyMarkdownImport: () => void;
  onDismissMarkdownImport: () => void;
  vaultImportReview: KnowledgeVaultImportReview | null;
  onApplyVaultImport: () => void;
  onDismissVaultImport: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function KnowledgeHomePanel({
  book,
  document,
  documents,
  activeDocumentId,
  title,
  tags,
  value,
  links,
  backlinks,
  isRelationsLoading,
  isLoading,
  isSaving,
  isSummaryCompressing,
  isCreatingDocument,
  isSaved,
  onTitleChange,
  onTagsChange,
  onChange,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  onCompressSummary,
  onExport,
  onImportMarkdown,
  onExportVault,
  onImportVault,
  onOpenBook,
  isMarkdownImporting,
  isMarkdownImportApplying,
  isVaultExporting,
  isVaultImporting,
  isVaultImportApplying,
  vaultConflicts,
  onDismissVaultConflicts,
  markdownImportReview,
  onApplyMarkdownImport,
  onDismissMarkdownImport,
  vaultImportReview,
  onApplyVaultImport,
  onDismissVaultImport,
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
              <input
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                aria-label={t("notes.knowledgeDocumentTitle")}
                placeholder={t("notes.knowledgeUntitledDocument")}
                className="mt-1 w-full min-w-0 truncate bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground focus-visible:text-primary"
              />
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{book.title}</p>
              <KnowledgeTagEditor tags={tags} onChange={onTagsChange} t={t} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
                <Save className="h-3.5 w-3.5" />
                {isSaving
                  ? t("notes.knowledgeSaving")
                  : isSaved
                    ? t("notes.knowledgeSaved")
                    : t("notes.knowledgePending")}
              </div>
              <KnowledgeExportMenu
                onExport={onExport}
                onImportMarkdown={onImportMarkdown}
                onExportVault={onExportVault}
                onImportVault={onImportVault}
                isMarkdownImporting={isMarkdownImporting}
                isVaultExporting={isVaultExporting}
                isVaultImporting={isVaultImporting}
                t={t}
              />
            </div>
          </div>

          {vaultConflicts ? (
            <KnowledgeVaultConflictCard
              notice={vaultConflicts}
              onDismiss={onDismissVaultConflicts}
              t={t}
            />
          ) : null}

          {markdownImportReview ? (
            <KnowledgeMarkdownImportReviewCard
              review={markdownImportReview}
              isApplying={isMarkdownImportApplying}
              onApply={onApplyMarkdownImport}
              onDismiss={onDismissMarkdownImport}
              t={t}
            />
          ) : null}

          {vaultImportReview ? (
            <KnowledgeVaultImportReviewCard
              review={vaultImportReview}
              isApplying={isVaultImportApplying}
              onApply={onApplyVaultImport}
              onDismiss={onDismissVaultImport}
              t={t}
            />
          ) : null}

          <KnowledgeEditor
            tier="knowledge_doc"
            surface={getKnowledgeEditorSurfaceForDocumentType(document.type)}
            value={value}
            onChange={onChange}
            placeholder={t("notes.knowledgePlaceholder")}
            className="border-border/70 bg-card shadow-sm"
            contentClassName="max-h-none min-h-[520px] px-6 py-5 [&_.ProseMirror]:min-h-[480px]"
          />
        </section>

        <aside className="space-y-3">
          <KnowledgeDocumentList
            documents={documents}
            activeDocumentId={activeDocumentId}
            isCreating={isCreatingDocument}
            onSelect={onSelectDocument}
            onCreate={onCreateDocument}
            onDelete={onDeleteDocument}
            t={t}
          />

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

          <KnowledgeRelationsPanel
            links={links}
            backlinks={backlinks}
            highlights={book.highlights}
            isLoading={isRelationsLoading}
            onSelectDocument={onSelectDocument}
            onOpenBook={onOpenBook}
            t={t}
          />

          <KnowledgeSummaryMemoryCard
            document={document}
            isCompressing={isSummaryCompressing}
            onCompress={onCompressSummary}
            t={t}
          />

          <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                {t("notes.knowledgeRecentExcerpts")}
              </p>
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

function KnowledgeTagEditor({
  tags,
  onChange,
  t,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = (rawValue = draft) => {
    const nextTags = rawValue
      .split(/[,\uFF0C]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (nextTags.length === 0) {
      setDraft("");
      return;
    }
    onChange(normalizeKnowledgeTags([...tags, ...nextTags]));
    setDraft("");
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag));
  };

  return (
    <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-1.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-card/70 px-2 text-[11px] font-medium text-muted-foreground">
        <Tag className="h-3 w-3" />
        {t("notes.knowledgeTags")}
      </div>
      {tags.map((tag) => (
        <span
          key={tag}
          className="group inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-muted/35 px-2 text-xs text-foreground"
        >
          <span className="max-w-28 truncate">{tag}</span>
          <button
            type="button"
            className="rounded-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={() => removeTag(tag)}
            aria-label={t("notes.knowledgeTagRemove", { tag })}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commitDraft()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitDraft();
          }
        }}
        aria-label={t("notes.knowledgeTagInputLabel")}
        placeholder={t("notes.knowledgeTagPlaceholder")}
        className="h-7 min-w-24 flex-1 rounded-md border border-dashed border-border/70 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-card"
      />
    </div>
  );
}

function knowledgeLinkTargetLabel(
  link: KnowledgeLink,
  highlights: HighlightWithBook[],
  t: (key: string, options?: Record<string, unknown>) => string,
): { title: string; detail: string; cfi?: string } {
  if (link.toKind === "highlight") {
    const highlight = highlights.find((item) => item.id === link.toId);
    return {
      title: link.label || highlight?.chapterTitle || t("notes.knowledgeSourceHighlight"),
      detail: highlight?.text || link.toId,
      cfi: link.cfi || highlight?.cfi,
    };
  }

  if (link.toKind === "cfi") {
    return {
      title: link.label || t("notes.knowledgeSourcePosition"),
      detail: link.cfi || link.toId,
      cfi: link.cfi || link.toId,
    };
  }

  if (link.toKind === "book") {
    return {
      title: link.label || t("notes.knowledgeSourceBook"),
      detail: link.toId,
    };
  }

  return {
    title: link.label || t("notes.knowledgeSourceReference"),
    detail: link.toId,
    cfi: link.cfi,
  };
}

function KnowledgeRelationsPanel({
  links,
  backlinks,
  highlights,
  isLoading,
  onSelectDocument,
  onOpenBook,
  t,
}: {
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  highlights: HighlightWithBook[];
  isLoading: boolean;
  onSelectDocument: (document: KnowledgeDocument) => void;
  onOpenBook: (cfi?: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const sourceLinks = links.filter((link) => link.relation === "source").slice(0, 4);
  const visibleBacklinks = backlinks.slice(0, 4);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs font-semibold text-foreground">{t("notes.knowledgeRelations")}</p>
        </div>
        {isLoading ? (
          <span className="text-[11px] text-muted-foreground">
            {t("notes.knowledgeRelationsLoading")}
          </span>
        ) : null}
      </div>

      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {t("notes.knowledgeSourceLinks")}
          </p>
          {sourceLinks.length === 0 ? (
            <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              {t("notes.knowledgeNoSourceLinks")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {sourceLinks.map((link) => {
                const target = knowledgeLinkTargetLabel(link, highlights, t);
                const canOpen = !!target.cfi || link.toKind === "book";
                return (
                  <button
                    key={link.id}
                    type="button"
                    className="w-full rounded-md border border-border/40 bg-background px-2.5 py-2 text-left transition-colors enabled:hover:border-primary/30 enabled:hover:bg-primary/5 disabled:cursor-default"
                    onClick={() => onOpenBook(target.cfi)}
                    disabled={!canOpen}
                    title={canOpen ? t("notes.knowledgeOpenRelation") : undefined}
                  >
                    <p className="truncate text-xs font-medium text-foreground">{target.title}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {target.detail}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {t("notes.knowledgeBacklinks")}
          </p>
          {visibleBacklinks.length === 0 ? (
            <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              {t("notes.knowledgeNoBacklinks")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {visibleBacklinks.map(({ link, fromDocument }) => (
                <button
                  key={link.id}
                  type="button"
                  className="w-full rounded-md border border-border/40 bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                  onClick={() => onSelectDocument(fromDocument)}
                >
                  <p className="truncate text-xs font-medium text-foreground">
                    {fromDocument.title || t("notes.knowledgeUntitledDocument")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {knowledgeDocumentTypeLabel(fromDocument, t)}
                  </p>
                  {fromDocument.excerpt ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {fromDocument.excerpt}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeSummaryMemoryCard({
  document,
  isCompressing,
  onCompress,
  t,
}: {
  document: KnowledgeDocument;
  isCompressing: boolean;
  onCompress: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const summary = document.summaryMd?.trim();
  const updatedAt = document.summaryUpdatedAt;
  const isStale =
    !!summary &&
    document.summarySourceFingerprint !== createKnowledgeSummarySourceFingerprint(document);
  const statusLabel = !summary
    ? t("notes.knowledgeSummaryMissing")
    : isStale
      ? t("notes.knowledgeSummaryStale")
      : t("notes.knowledgeSummaryReady");

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              {t("notes.knowledgeSummaryMemory")}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[11px]",
                !summary ? "text-muted-foreground" : isStale ? "text-foreground" : "text-primary",
              )}
            >
              {statusLabel}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCompress}
          disabled={isCompressing}
        >
          {isCompressing ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-primary/30 border-t-primary" />
          ) : (
            <Sparkles className="h-3 w-3 text-primary" />
          )}
          {isCompressing
            ? t("notes.knowledgeSummaryCompressing")
            : t("notes.knowledgeSummaryCompress")}
        </button>
      </div>

      {summary ? (
        <div className="rounded-md border border-border/40 bg-background px-2.5 py-2">
          <div className="max-h-36 overflow-hidden text-[11px] leading-relaxed text-muted-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <p className="mb-1 text-xs font-semibold text-foreground">{children}</p>
                ),
                h2: ({ children }) => (
                  <p className="mb-1 text-xs font-semibold text-foreground">{children}</p>
                ),
                h3: ({ children }) => (
                  <p className="mb-1 text-[11px] font-semibold text-foreground">{children}</p>
                ),
                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-1 list-disc pl-4 last:mb-0">{children}</ul>,
                ol: ({ children }) => (
                  <ol className="mb-1 list-decimal pl-4 last:mb-0">{children}</ol>
                ),
                li: ({ children }) => <li className="mb-0.5">{children}</li>,
              }}
            >
              {summary}
            </ReactMarkdown>
          </div>
          {updatedAt ? (
            <p className="mt-2 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
              {t("notes.knowledgeSummaryUpdatedAt", {
                time: new Date(updatedAt).toLocaleString(),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("notes.knowledgeSummaryPreview")}
        </p>
      )}
    </div>
  );
}

function knowledgeDocumentTypeLabel(
  document: KnowledgeDocument,
  t: (key: string) => string,
): string {
  if (document.type === "book_home") return t("notes.knowledgeDocumentHome");
  if (document.type === "review") return t("notes.knowledgeDocumentReview");
  if (document.type === "summary") return t("notes.knowledgeDocumentSummary");
  if (document.type === "highlight_note") return t("notes.knowledgeDocumentHighlight");
  return t("notes.knowledgeDocumentNote");
}

function KnowledgeDocumentList({
  documents,
  activeDocumentId,
  isCreating,
  onSelect,
  onCreate,
  onDelete,
  t,
}: {
  documents: KnowledgeDocument[];
  activeDocumentId: string | null;
  isCreating: boolean;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType) => void;
  onDelete: (document: KnowledgeDocument) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [query, setQuery] = useState("");
  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return documents;

    return documents.filter((document) => {
      const haystack = [
        document.title,
        knowledgeDocumentTypeLabel(document, t),
        document.excerpt ?? "",
        document.contentMd,
        ...document.tags,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [documents, query, t]);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">{t("notes.knowledgeDocuments")}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isCreating}
              aria-label={t("notes.knowledgeNewDocument")}
              title={t("notes.knowledgeNewDocument")}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onCreate("standalone_note")}>
              <FileText className="mr-2 h-4 w-4" />
              {t("notes.knowledgeNewNote")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCreate("review")}>
              <NotebookPen className="mr-2 h-4 w-4" />
              {t("notes.knowledgeNewReview")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCreate("summary")}>
              <Sparkles className="mr-2 h-4 w-4" />
              {t("notes.knowledgeNewSummary")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("notes.knowledgeDocumentSearchPlaceholder")}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <div className="space-y-1">
        {visibleDocuments.length === 0 ? (
          <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
            {t("notes.knowledgeNoDocumentResults")}
          </p>
        ) : null}
        {visibleDocuments.map((document) => {
          const isActive = document.id === activeDocumentId;
          const title = document.title.trim() || t("notes.knowledgeUntitledDocument");
          const canDelete = canDeleteKnowledgeDocument(document);

          return (
            <div
              key={document.id}
              className={cn(
                "group flex w-full items-stretch rounded-md border transition-colors",
                isActive
                  ? "border-primary/30 bg-primary/10"
                  : "border-transparent hover:border-border/60 hover:bg-muted/45",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 px-2.5 py-2 text-left"
                onClick={() => onSelect(document)}
              >
                <div className="flex items-start gap-2">
                  <FileText
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-xs font-medium",
                        isActive ? "text-primary" : "text-foreground",
                      )}
                    >
                      {title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {knowledgeDocumentTypeLabel(document, t)}
                    </p>
                  </div>
                </div>
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="my-1 mr-1 flex w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onDelete(document)}
                  aria-label={t("notes.knowledgeDeleteDocument")}
                  title={t("notes.knowledgeDeleteDocument")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KnowledgeVaultConflictCard({
  notice,
  onDismiss,
  t,
}: {
  notice: KnowledgeVaultConflictNotice;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visiblePaths = notice.paths.slice(0, 4);
  const hiddenCount = Math.max(0, notice.paths.length - visiblePaths.length);

  return (
    <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {notice.kind === "external_modified"
                  ? t("notes.knowledgeVaultConflictTitle")
                  : t("notes.knowledgeVaultExistingTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {notice.kind === "external_modified"
                  ? t("notes.knowledgeVaultConflictDescription")
                  : t("notes.knowledgeVaultExistingDescription")}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
              onClick={onDismiss}
              aria-label={t("common.close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-2">
            <p className="truncate text-[11px] text-muted-foreground">{notice.rootPath}</p>
            <div className="mt-1 space-y-1">
              {visiblePaths.map((path) => (
                <p key={path} className="truncate font-mono text-[11px] text-foreground/85">
                  {path}
                </p>
              ))}
              {hiddenCount > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("notes.knowledgeVaultConflictMore", { count: hiddenCount })}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeMarkdownImportReviewCard({
  review,
  isApplying,
  onApply,
  onDismiss,
  t,
}: {
  review: KnowledgeMarkdownImportReview;
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visibleItems = review.items.slice(0, 5);
  const hiddenCount = Math.max(0, review.items.length - visibleItems.length);

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-border/70 bg-card text-sm shadow-sm">
      <div className="border-b border-border/60 bg-muted/25 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {t("notes.knowledgeMarkdownImportTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("notes.knowledgeMarkdownImportDescription", { count: review.items.length })}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            onClick={onDismiss}
            aria-label={t("common.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {visibleItems.map((item) => {
          const proposal = item.proposal;
          const title =
            proposal.action === "create"
              ? proposal.draft.title
              : (proposal.patch.title ?? proposal.current?.title ?? proposal.documentId);
          const tags =
            proposal.action === "create"
              ? (proposal.draft.tags ?? [])
              : (proposal.patch.tags ?? proposal.current?.tags ?? []);
          const preview =
            proposal.action === "create"
              ? proposal.draft.excerpt || proposal.draft.contentMd
              : proposal.patch.excerpt ||
                proposal.patch.contentMd ||
                proposal.current?.excerpt ||
                "";

          return (
            <div
              key={item.path}
              className="rounded-md border border-border/55 bg-background px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {desktopFileName(item.path)}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {proposal.action === "create"
                    ? t("notes.knowledgeMarkdownImportWillCreate")
                    : t("notes.knowledgeVaultImportWillUpdate")}
                </span>
              </div>

              {preview ? (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {preview}
                </p>
              ) : null}

              {tags.length > 0 || item.warnings.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 5 ? (
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                      +{tags.length - 5}
                    </span>
                  ) : null}
                  {item.warnings.length > 0 ? (
                    <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {t("notes.knowledgeMarkdownImportWarningCount", {
                        count: item.warnings.length,
                      })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {hiddenCount > 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {t("notes.knowledgeMarkdownImportMoreFiles", { count: hiddenCount })}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="min-w-0 text-xs text-muted-foreground">
            {t("notes.knowledgeMarkdownImportSafeHint")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onDismiss}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={isApplying || review.items.length === 0}
              onClick={onApply}
            >
              {isApplying
                ? t("notes.knowledgeMarkdownImportApplying")
                : t("notes.knowledgeMarkdownImportApply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeVaultImportReviewCard({
  review,
  isApplying,
  onApply,
  onDismiss,
  t,
}: {
  review: KnowledgeVaultImportReview;
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visibleModified = review.plan.modified.slice(0, 4);
  const issueEntries = [
    ...review.plan.conflicts,
    ...review.plan.missing,
    ...review.plan.unreadable,
  ];
  const visibleIssues = issueEntries.slice(0, 3);
  const hiddenModifiedCount = Math.max(0, review.plan.modified.length - visibleModified.length);
  const hiddenIssueCount = Math.max(0, issueEntries.length - visibleIssues.length);
  const proposalByDocumentId = new Map(
    review.proposals.map((proposal) => [proposal.documentId, proposal] as const),
  );

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.035] text-sm shadow-sm">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FolderDown className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{t("notes.knowledgeVaultImportTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("notes.knowledgeVaultImportDescription")}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
              onClick={onDismiss}
              aria-label={t("common.close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.modified.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportModified")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.conflicts.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportConflicts")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.missing.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportMissing")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.unreadable.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportUnreadable")}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border/50 bg-background/70 px-2.5 py-2">
            <p className="truncate text-[11px] text-muted-foreground">{review.rootPath}</p>
            {visibleModified.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {visibleModified.map((entry) => {
                  const proposal = proposalByDocumentId.get(entry.documentId);
                  const title = proposal?.patch.title ?? proposal?.current?.title ?? entry.path;
                  return (
                    <div
                      key={entry.documentId}
                      className="rounded-md border border-border/40 bg-card px-2.5 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{title}</p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {entry.path}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                          {t("notes.knowledgeVaultImportWillUpdate")}
                        </span>
                      </div>
                      {proposal?.changedFields.length ? (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {t("notes.knowledgeVaultImportChangedFields", {
                            fields: proposal.changedFields.join(", "),
                          })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {hiddenModifiedCount > 0 ? (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {t("notes.knowledgeVaultImportMoreModified", { count: hiddenModifiedCount })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {visibleIssues.length > 0 ? (
              <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("notes.knowledgeVaultImportIssues")}
                </div>
                <div className="space-y-1">
                  {visibleIssues.map((entry) => (
                    <div
                      key={`${entry.status}:${entry.path}`}
                      className="flex min-w-0 items-center justify-between gap-2"
                    >
                      <p className="min-w-0 truncate font-mono text-[11px] text-foreground/80">
                        {entry.path}
                      </p>
                      <span className="shrink-0 rounded-md bg-background/75 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {entry.status === "conflict"
                          ? t("notes.knowledgeVaultImportConflictIssue")
                          : entry.status === "missing"
                            ? t("notes.knowledgeVaultImportMissingIssue")
                            : t("notes.knowledgeVaultImportUnreadableIssue")}
                      </span>
                    </div>
                  ))}
                  {hiddenIssueCount > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("notes.knowledgeVaultImportMoreIssues", { count: hiddenIssueCount })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              {review.plan.conflicts.length > 0
                ? t("notes.knowledgeVaultImportConflictSafeHint")
                : review.proposals.length > 0
                  ? t("notes.knowledgeVaultImportSafeHint")
                  : t("notes.knowledgeVaultImportNoApplicableChanges")}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onDismiss}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={isApplying || review.proposals.length === 0}
                onClick={onApply}
              >
                {isApplying
                  ? t("notes.knowledgeVaultImportApplying")
                  : t("notes.knowledgeVaultImportApply")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeExportMenu({
  onExport,
  onImportMarkdown,
  onExportVault,
  onImportVault,
  isMarkdownImporting,
  isVaultExporting,
  isVaultImporting,
  t,
}: {
  onExport: (format: KnowledgeExportFormat) => void;
  onImportMarkdown: () => void;
  onExportVault: () => void;
  onImportVault: () => void;
  isMarkdownImporting: boolean;
  isVaultExporting: boolean;
  isVaultImporting: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <Download className="h-3 w-3" />
          {t("notes.export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport("obsidian")}>
          <FileText className="mr-2 h-4 w-4" />
          {t("notes.exportObsidian")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("markdown")}>
          <FileText className="mr-2 h-4 w-4" />
          {t("notes.exportMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImportMarkdown} disabled={isMarkdownImporting}>
          <FileText className="mr-2 h-4 w-4" />
          {isMarkdownImporting
            ? t("notes.knowledgeMarkdownImporting")
            : t("notes.knowledgeImportMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportVault} disabled={isVaultExporting}>
          <FolderUp className="mr-2 h-4 w-4" />
          {isVaultExporting ? t("notes.knowledgeVaultExporting") : t("notes.knowledgeExportVault")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportVault} disabled={isVaultImporting}>
          <FolderDown className="mr-2 h-4 w-4" />
          {isVaultImporting ? t("notes.knowledgeVaultImporting") : t("notes.knowledgeImportVault")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
              tier="inline_note"
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
