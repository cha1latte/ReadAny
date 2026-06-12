import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import {
  MobileKnowledgeEditor,
  type MobileKnowledgeEditorOutlineTarget,
  type MobileKnowledgeEditorValue,
  type MobileKnowledgeImageInsertAttrs,
  type MobileKnowledgeInternalLinkTarget,
} from "@/components/knowledge/MobileKnowledgeEditor";
import {
  BookOpenIcon,
  BrainIcon,
  CheckCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  HighlighterIcon,
  ListIcon,
  LoaderIcon,
  MoreVerticalIcon,
  NotebookPenIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  ShareIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { SyncButton } from "@/components/ui/SyncButton";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { pickAndPersistMobileKnowledgeImageAttachment } from "@/lib/knowledge/attachment-assets-mobile";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useAnnotationStore, useLibraryStore, useSettingsStore } from "@/stores";
import { useColors, useTheme } from "@/styles/theme";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { maybeCompressAndPersistKnowledgeSummary } from "@readany/core/ai";
import {
  type HighlightWithBook,
  type KnowledgeBacklink,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  ensureBookHomeDocument,
  ensureHighlightNoteKnowledgeDocuments,
  ensureNoteKnowledgeDocuments,
  getKnowledgeAttachments,
  getKnowledgeBacklinks,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  updateKnowledgeDocument,
} from "@readany/core/db/database";
import {
  AnnotationExporter,
  type ExportFormat,
  type KnowledgeExportFormat,
  type KnowledgeImportWriteProposal,
  createKnowledgeImportWriteProposal,
  knowledgeExporter,
  parseKnowledgeMarkdownDocument,
} from "@readany/core/export";
import {
  type KnowledgeDocumentOutlineItem,
  type KnowledgeDocumentTreeNode,
  buildKnowledgeDocumentTree,
  canonicalizeKnowledgeAttachmentImageSources,
  createKnowledgeExcerpt,
  createKnowledgeSummarySourceFingerprint,
  extractKnowledgeDocumentOutline,
  flattenKnowledgeDocumentTree,
  getKnowledgeEditorSurfaceForDocumentType,
  knowledgeDocumentFingerprint,
  markdownToBasicTiptap,
  normalizeTiptapDocument,
  orderKnowledgeDocuments,
  renderKnowledgeJsonToMarkdown,
  resolveKnowledgeAttachmentImageSources,
  syncKnowledgeInternalDocumentLinks,
  validateKnowledgeDocumentParent,
} from "@readany/core/knowledge";
import { applyKnowledgeWriteProposal } from "@readany/core/knowledge/proposals";
import { sortAnnotationsByPosition } from "@readany/core/reader";
import { getPlatformService } from "@readany/core/services";
import type {
  Book,
  Highlight,
  KnowledgeAttachment,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
} from "@readany/core/types";
import { eventBus } from "@readany/core/utils/event-bus";
import type { TFunction } from "i18next";
/**
 * NotesView — mobile notes plus book-centered knowledge vault.
 * Knowledge documents keep an Obsidian-like folder hierarchy and open into a
 * focused WYSIWYG editor surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { HighlightCard } from "./notes/HighlightCard";
import { NoteCard } from "./notes/NoteCard";
import { NotebookCard } from "./notes/NotebookCard";
import { makeStyles } from "./notes/notes-styles";
import { useResolvedCovers } from "./notes/useResolvedCovers";

const NOTE_PNG = require("../../assets/note.png");
const NOTE_DARK_PNG = require("../../assets/note-dark.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailTab = "knowledge" | "notes" | "highlights";
type MobileKnowledgeWorkspaceMode = "vault" | "document";
type CreatableKnowledgeDocumentType = Extract<
  KnowledgeDocumentType,
  "folder" | "standalone_note" | "review" | "summary"
>;

interface KnowledgeMarkdownImportReviewItem {
  path: string;
  proposal: KnowledgeImportWriteProposal;
  warnings: string[];
}

interface KnowledgeMarkdownImportReview {
  items: KnowledgeMarkdownImportReviewItem[];
}

function createEmptyKnowledgeValue(): MobileKnowledgeEditorValue {
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

function mobileFileName(path: string): string {
  const fileName = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function canDeleteKnowledgeDocument(document: KnowledgeDocument): boolean {
  if (document.type === "book_home") return false;
  if (document.sourceKind === "highlight" || document.sourceKind === "note") return false;
  return true;
}

function knowledgeDocumentCreateTitle(
  type: CreatableKnowledgeDocumentType,
  count: number,
  t: TFunction,
): string {
  if (type === "folder") return t("notes.knowledgeNewFolderTitle", { count });
  if (type === "review") return t("notes.knowledgeNewReviewTitle", { count });
  if (type === "summary") return t("notes.knowledgeNewSummaryTitle", { count });
  return t("notes.knowledgeNewNoteTitle", { count });
}

function isEmptyTiptapDocument(contentJson: KnowledgeDocument["contentJson"]): boolean {
  const doc = normalizeTiptapDocument(contentJson);
  return !doc.content || doc.content.length === 0;
}

function createKnowledgeContentJson(document: KnowledgeDocument): KnowledgeDocument["contentJson"] {
  if (document.contentMd.trim() && isEmptyTiptapDocument(document.contentJson)) {
    return markdownToBasicTiptap(document.contentMd) as unknown as KnowledgeDocument["contentJson"];
  }
  return normalizeTiptapDocument(
    document.contentJson,
  ) as unknown as KnowledgeDocument["contentJson"];
}

function createKnowledgeValue(
  document: KnowledgeDocument,
  contentJsonOverride?: KnowledgeDocument["contentJson"],
): MobileKnowledgeEditorValue {
  const contentJson = contentJsonOverride ?? createKnowledgeContentJson(document);
  const contentMd = document.contentMd || renderKnowledgeJsonToMarkdown(contentJson);
  return {
    contentJson,
    contentMd,
    plainText: contentMd
      .replace(/[#>*_`~\-[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function resolveKnowledgeAttachmentDisplaySrc(attachment: KnowledgeAttachment): string | undefined {
  if (!attachment.localPath) return undefined;
  try {
    return getPlatformService().convertFileSrc(attachment.localPath);
  } catch (error) {
    console.warn("[Notes] Failed to resolve knowledge attachment image source:", error);
    return attachment.localPath;
  }
}

async function createResolvedKnowledgeValue(
  document: KnowledgeDocument,
): Promise<MobileKnowledgeEditorValue> {
  let attachments: KnowledgeAttachment[] = [];
  try {
    attachments = await getKnowledgeAttachments(document.id);
  } catch (error) {
    console.warn("[Notes] Failed to load knowledge attachments:", error);
    return createKnowledgeValue(document);
  }
  if (attachments.length === 0) return createKnowledgeValue(document);

  const displaySrcByAttachmentId = new Map<string, string>();
  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue;
    const displaySrc = resolveKnowledgeAttachmentDisplaySrc(attachment);
    if (displaySrc) displaySrcByAttachmentId.set(attachment.id, displaySrc);
  }

  if (displaySrcByAttachmentId.size === 0) return createKnowledgeValue(document);

  const contentJson = createKnowledgeContentJson(document);
  const resolvedContentJson = resolveKnowledgeAttachmentImageSources(contentJson, (attachmentId) =>
    displaySrcByAttachmentId.get(attachmentId),
  ) as KnowledgeDocument["contentJson"];

  return createKnowledgeValue(document, resolvedContentJson);
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

export function NotesView({
  initialBookId,
  showBackButton,
  edges = ["top"],
  hideDetailHeader,
}: {
  initialBookId?: string | null;
  showBackButton?: boolean;
  edges?: ("top" | "bottom" | "left" | "right")[];
  hideDetailHeader?: boolean;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const s = makeStyles(colors);
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const {
    highlightsWithBooks,
    loadAllHighlightsWithBooks,
    removeHighlight,
    updateHighlight,
    stats,
    loadStats,
  } = useAnnotationStore();
  const books = useLibraryStore((s) => s.books);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(initialBookId || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>(initialBookId ? "notes" : "knowledge");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [knowledgeHome, setKnowledgeHome] = useState<KnowledgeDocument | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedKnowledgeDocumentId, setSelectedKnowledgeDocumentId] = useState<string | null>(
    null,
  );
  const [isKnowledgeVaultRootOpen, setIsKnowledgeVaultRootOpen] = useState(false);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeTags, setKnowledgeTags] = useState<string[]>([]);
  const [knowledgeValue, setKnowledgeValue] = useState<MobileKnowledgeEditorValue>(() =>
    createEmptyKnowledgeValue(),
  );
  const [savedKnowledgeFingerprint, setSavedKnowledgeFingerprint] = useState(() =>
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
  const [knowledgeMarkdownImportReview, setKnowledgeMarkdownImportReview] =
    useState<KnowledgeMarkdownImportReview | null>(null);
  const knowledgeSaveVersionRef = useRef(0);
  const currentKnowledgeFingerprint = useMemo(
    () => knowledgeDocumentFingerprint(knowledgeTitle, knowledgeValue, knowledgeTags),
    [knowledgeTitle, knowledgeTags, knowledgeValue],
  );
  const knowledgeDocumentIds = useMemo(
    () => knowledgeDocuments.map((document) => document.id),
    [knowledgeDocuments],
  );

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() =>
        setIsLoading(false),
      );

      return () => {
        setSelectedBookId(null);
        setEditingId(null);
        setSearchQuery("");
        setIsKnowledgeVaultRootOpen(false);
      };
    }, [loadAllHighlightsWithBooks, loadStats]),
  );

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      setIsLoading(true);
      Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() =>
        setIsLoading(false),
      );
    });
  }, [loadAllHighlightsWithBooks, loadStats]);

  // Handle incoming bookId
  useEffect(() => {
    if (initialBookId) {
      setSelectedBookId(initialBookId);
      setSearchQuery("");
      setEditingId(null);
      setDetailTab("notes");
    }
  }, [initialBookId]);

  // Group by book, while keeping every library book available as a knowledge workspace.
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
        title: book.meta.title || t("notes.unknownBook", "未知书籍"),
        author: book.meta.author || t("notes.unknownAuthor", "未知作者"),
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
          title: h.bookTitle || t("notes.unknownBook", "未知书籍"),
          author: h.bookAuthor || t("notes.unknownAuthor", "未知作者"),
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

  // Resolve cover URLs using shared hook
  const resolvedCovers = useResolvedCovers(bookNotebooks);

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
    setIsKnowledgeVaultRootOpen(false);
  }, [bookNotebooks, selectedBookId]);

  const { notesList, highlightsList } = useMemo(() => {
    if (!selectedBook) return { notesList: [], highlightsList: [] };
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
      notesList: sorted.filter((h) => h.note),
      highlightsList: sorted.filter((h) => !h.note),
    };
  }, [selectedBook, searchQuery]);

  const currentList =
    detailTab === "notes" ? notesList : detailTab === "highlights" ? highlightsList : [];

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters: { chapter: string; items: HighlightWithBook[] }[] = [];
    const chapterMap = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter", "未知章节");
      const arr = chapterMap.get(chapter) || [];
      arr.push(h);
      chapterMap.set(chapter, arr);
    }
    for (const [chapter, items] of chapterMap) {
      chapters.push({ chapter, items });
    }
    return chapters;
  }, [currentList, t]);

  const handleOpenBook = useCallback(
    (bookId: string, cfi?: string) => {
      void openMobileBook({ bookId, navigation: nav, t, cfi });
    },
    [nav, t],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadKnowledgeHome() {
      knowledgeSaveVersionRef.current += 1;

      if (!selectedKnowledgeBookId) {
        const emptyValue = createEmptyKnowledgeValue();
        setKnowledgeHome(null);
        setKnowledgeDocuments([]);
        setSelectedKnowledgeDocumentId(null);
        setIsKnowledgeVaultRootOpen(false);
        setKnowledgeTitle("");
        setKnowledgeTags([]);
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
        const nextValue = await createResolvedKnowledgeValue(activeDocument);
        setKnowledgeDocuments(nextDocuments);
        setSelectedKnowledgeDocumentId(activeDocument.id);
        setIsKnowledgeVaultRootOpen(false);
        setKnowledgeHome(activeDocument);
        setKnowledgeTitle(activeDocument.title);
        setKnowledgeTags(normalizeKnowledgeTags(activeDocument.tags));
        setKnowledgeValue(nextValue);
        setSavedKnowledgeFingerprint(
          knowledgeDocumentFingerprint(activeDocument.title, nextValue, activeDocument.tags),
        );
      } catch (error) {
        console.error("[Notes] Failed to load knowledge home:", error);
        Alert.alert(t("common.error", "错误"), t("notes.knowledgeLoadFailed", "知识主页加载失败"));
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
    const valueToSave = knowledgeValue;
    const nextExcerpt = createKnowledgeExcerpt(valueToSave.contentMd);
    const contentJsonForStorage = canonicalizeKnowledgeAttachmentImageSources(
      valueToSave.contentJson,
    ) as KnowledgeDocument["contentJson"];

    const timeout = setTimeout(async () => {
      if (knowledgeSaveVersionRef.current !== saveVersion) return;
      setIsKnowledgeSaving(true);
      try {
        await updateKnowledgeDocument(knowledgeHome.id, {
          title: normalizedTitle,
          contentMd: valueToSave.contentMd,
          contentJson: contentJsonForStorage,
          excerpt: nextExcerpt,
          tags: normalizedTags,
        });
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        const linkSync = await syncKnowledgeInternalDocumentLinks({
          documentId: knowledgeHome.id,
          contentJson: contentJsonForStorage,
          validDocumentIds: knowledgeDocumentIds,
        });
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        if (linkSync.added > 0 || linkSync.deleted > 0) {
          const [links, backlinks] = await Promise.all([
            getKnowledgeLinks(knowledgeHome.id),
            getKnowledgeBacklinks(knowledgeHome.id),
          ]);
          if (knowledgeSaveVersionRef.current !== saveVersion) return;
          setKnowledgeLinks(links);
          setKnowledgeBacklinks(backlinks);
        }
        const updatedDocument: KnowledgeDocument = {
          ...knowledgeHome,
          title: normalizedTitle,
          contentMd: valueToSave.contentMd,
          contentJson: contentJsonForStorage,
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
          knowledgeDocumentFingerprint(normalizedTitle, valueToSave, normalizedTags),
        );
      } catch (error) {
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        console.error("[Notes] Failed to save knowledge home:", error);
        Alert.alert(t("common.error", "错误"), t("notes.knowledgeSaveFailed", "知识主页保存失败"));
      } finally {
        if (knowledgeSaveVersionRef.current === saveVersion) {
          setIsKnowledgeSaving(false);
        }
      }
    }, 700);

    return () => clearTimeout(timeout);
  }, [
    knowledgeHome,
    knowledgeDocumentIds,
    knowledgeTitle,
    knowledgeTags,
    knowledgeValue,
    currentKnowledgeFingerprint,
    savedKnowledgeFingerprint,
    t,
  ]);

  const saveActiveKnowledgeDocumentNow = useCallback(async (): Promise<boolean> => {
    if (!knowledgeHome || currentKnowledgeFingerprint === savedKnowledgeFingerprint) return true;

    const saveVersion = knowledgeSaveVersionRef.current + 1;
    knowledgeSaveVersionRef.current = saveVersion;
    const normalizedTitle = knowledgeTitle.trim() || knowledgeHome.title;
    const normalizedTags = normalizeKnowledgeTags(knowledgeTags);
    const nextExcerpt = createKnowledgeExcerpt(knowledgeValue.contentMd);
    const contentJsonForStorage = canonicalizeKnowledgeAttachmentImageSources(
      knowledgeValue.contentJson,
    ) as KnowledgeDocument["contentJson"];

    setIsKnowledgeSaving(true);
    try {
      await updateKnowledgeDocument(knowledgeHome.id, {
        title: normalizedTitle,
        contentMd: knowledgeValue.contentMd,
        contentJson: contentJsonForStorage,
        excerpt: nextExcerpt,
        tags: normalizedTags,
      });
      if (knowledgeSaveVersionRef.current !== saveVersion) return false;
      const linkSync = await syncKnowledgeInternalDocumentLinks({
        documentId: knowledgeHome.id,
        contentJson: contentJsonForStorage,
        validDocumentIds: knowledgeDocumentIds,
      });
      if (knowledgeSaveVersionRef.current !== saveVersion) return false;
      if (linkSync.added > 0 || linkSync.deleted > 0) {
        const [links, backlinks] = await Promise.all([
          getKnowledgeLinks(knowledgeHome.id),
          getKnowledgeBacklinks(knowledgeHome.id),
        ]);
        if (knowledgeSaveVersionRef.current !== saveVersion) return false;
        setKnowledgeLinks(links);
        setKnowledgeBacklinks(backlinks);
      }
      const updatedDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: normalizedTitle,
        contentMd: knowledgeValue.contentMd,
        contentJson: contentJsonForStorage,
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
        Alert.alert(t("common.error", "错误"), t("notes.knowledgeSaveFailed", "知识主页保存失败"));
      }
      return false;
    } finally {
      if (knowledgeSaveVersionRef.current === saveVersion) {
        setIsKnowledgeSaving(false);
      }
    }
  }, [
    knowledgeHome,
    knowledgeDocumentIds,
    knowledgeTitle,
    knowledgeTags,
    knowledgeValue,
    currentKnowledgeFingerprint,
    savedKnowledgeFingerprint,
    t,
  ]);

  const openKnowledgeDocument = useCallback(
    async (document: KnowledgeDocument) => {
      if (document.id === knowledgeHome?.id) {
        setSelectedKnowledgeDocumentId(document.id);
        setIsKnowledgeVaultRootOpen(false);
        return;
      }
      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      knowledgeSaveVersionRef.current += 1;
      const nextValue = await createResolvedKnowledgeValue(document);
      setSelectedKnowledgeDocumentId(document.id);
      setIsKnowledgeVaultRootOpen(false);
      setKnowledgeHome(document);
      setKnowledgeTitle(document.title);
      setKnowledgeTags(normalizeKnowledgeTags(document.tags));
      setKnowledgeValue(nextValue);
      setSavedKnowledgeFingerprint(
        knowledgeDocumentFingerprint(document.title, nextValue, document.tags),
      );
      setIsKnowledgeSaving(false);
    },
    [knowledgeHome?.id, saveActiveKnowledgeDocumentNow],
  );

  const openKnowledgeVaultRoot = useCallback(async () => {
    if (isKnowledgeVaultRootOpen) return;
    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;
    setSelectedKnowledgeDocumentId(null);
    setIsKnowledgeVaultRootOpen(true);
  }, [isKnowledgeVaultRootOpen, saveActiveKnowledgeDocumentNow]);

  const refreshSelectedKnowledgeDocuments = useCallback(
    async (preferredDocumentId?: string | null) => {
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
        const emptyValue = createEmptyKnowledgeValue();
        setSelectedKnowledgeDocumentId(null);
        setIsKnowledgeVaultRootOpen(false);
        setKnowledgeHome(null);
        setKnowledgeTitle("");
        setKnowledgeTags([]);
        setKnowledgeValue(emptyValue);
        setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
        setIsKnowledgeSaving(false);
        return;
      }

      const nextValue = await createResolvedKnowledgeValue(nextActiveDocument);
      setSelectedKnowledgeDocumentId(nextActiveDocument.id);
      setIsKnowledgeVaultRootOpen(false);
      setKnowledgeHome(nextActiveDocument);
      setKnowledgeTitle(nextActiveDocument.title);
      setKnowledgeTags(normalizeKnowledgeTags(nextActiveDocument.tags));
      setKnowledgeValue(nextValue);
      setSavedKnowledgeFingerprint(
        knowledgeDocumentFingerprint(nextActiveDocument.title, nextValue, nextActiveDocument.tags),
      );
      setIsKnowledgeSaving(false);
    },
    [knowledgeHome?.id, selectedKnowledgeBookId, selectedKnowledgeBookTitle],
  );

  useEffect(() => {
    return eventBus.on("knowledge:changed", (event) => {
      if (!selectedKnowledgeBookId) return;
      if (event.bookId && event.bookId !== selectedKnowledgeBookId) return;

      void (async () => {
        try {
          const preferredDocumentId =
            event.action === "create" ? event.documentId : selectedKnowledgeDocumentId;
          await refreshSelectedKnowledgeDocuments(preferredDocumentId);
          if (event.action === "link" && event.documentId === activeKnowledgeDocumentId) {
            const [links, backlinks] = await Promise.all([
              getKnowledgeLinks(activeKnowledgeDocumentId),
              getKnowledgeBacklinks(activeKnowledgeDocumentId),
            ]);
            setKnowledgeLinks(links);
            setKnowledgeBacklinks(backlinks);
          }
        } catch (error) {
          console.error("[Notes] Failed to refresh knowledge after proposal apply:", error);
        }
      })();
    });
  }, [
    activeKnowledgeDocumentId,
    refreshSelectedKnowledgeDocuments,
    selectedKnowledgeBookId,
    selectedKnowledgeDocumentId,
  ]);

  const handleCreateKnowledgeDocument = useCallback(
    async (type: CreatableKnowledgeDocumentType = "standalone_note", parentId?: string) => {
      if (!selectedKnowledgeBookId || isKnowledgeDocumentCreating) return;
      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      setIsKnowledgeDocumentCreating(true);
      try {
        const emptyValue = createEmptyKnowledgeValue();
        const count = Math.max(
          1,
          knowledgeDocuments.filter(
            (document) => document.type === type && document.parentId === parentId,
          ).length + 1,
        );
        const document = await createKnowledgeDocument({
          bookId: selectedKnowledgeBookId,
          type,
          title: knowledgeDocumentCreateTitle(type, count, t),
          contentJson: emptyValue.contentJson,
          contentMd: "",
          excerpt: undefined,
          tags: [],
          sourceKind: "book",
          sourceId: selectedKnowledgeBookId,
          parentId,
        });
        const nextValue = createKnowledgeValue(document);
        setKnowledgeDocuments((documents) =>
          orderKnowledgeDocuments(
            [document, ...documents],
            documents.find((item) => item.type === "book_home")?.id,
          ),
        );
        setSelectedKnowledgeDocumentId(document.id);
        setIsKnowledgeVaultRootOpen(false);
        setKnowledgeHome(document);
        setKnowledgeTitle(document.title);
        setKnowledgeTags([]);
        setKnowledgeValue(nextValue);
        setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint(document.title, nextValue, []));
      } catch (error) {
        console.error("[Notes] Failed to create knowledge document:", error);
        Alert.alert(
          t("common.error", "错误"),
          t("notes.knowledgeDocumentCreateFailed", "知识文档创建失败"),
        );
      } finally {
        setIsKnowledgeDocumentCreating(false);
      }
    },
    [
      selectedKnowledgeBookId,
      isKnowledgeDocumentCreating,
      saveActiveKnowledgeDocumentNow,
      t,
      knowledgeDocuments,
    ],
  );

  const handleDeleteKnowledgeDocument = useCallback(
    (document: KnowledgeDocument) => {
      if (!canDeleteKnowledgeDocument(document)) {
        Alert.alert(
          t("common.error", "错误"),
          t("notes.knowledgeDocumentDeleteBlocked", "这个文档暂不支持直接删除"),
        );
        return;
      }
      if (
        document.type === "folder" &&
        knowledgeDocuments.some((item) => item.parentId === document.id)
      ) {
        Alert.alert(
          t("common.error", "错误"),
          t("notes.knowledgeFolderDeleteBlocked", "请先移动或删除这个文件夹里的文档"),
        );
        return;
      }

      Alert.alert(
        t("notes.knowledgeDeleteDocument", "删除文档"),
        t("notes.knowledgeDocumentDeleteConfirm", { title: document.title }),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("common.delete", "删除"),
            style: "destructive",
            onPress: () => {
              void (async () => {
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
                      const nextValue = await createResolvedKnowledgeValue(nextDocument);
                      setSelectedKnowledgeDocumentId(nextDocument.id);
                      setIsKnowledgeVaultRootOpen(false);
                      setKnowledgeHome(nextDocument);
                      setKnowledgeTitle(nextDocument.title);
                      setKnowledgeTags(normalizeKnowledgeTags(nextDocument.tags));
                      setKnowledgeValue(nextValue);
                      setSavedKnowledgeFingerprint(
                        knowledgeDocumentFingerprint(
                          nextDocument.title,
                          nextValue,
                          nextDocument.tags,
                        ),
                      );
                    } else {
                      const emptyValue = createEmptyKnowledgeValue();
                      setSelectedKnowledgeDocumentId(null);
                      setIsKnowledgeVaultRootOpen(false);
                      setKnowledgeHome(null);
                      setKnowledgeTitle("");
                      setKnowledgeTags([]);
                      setKnowledgeValue(emptyValue);
                      setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
                    }
                    setIsKnowledgeSaving(false);
                  } else if (selectedKnowledgeDocumentId === document.id) {
                    setSelectedKnowledgeDocumentId(knowledgeHome?.id ?? null);
                  }
                } catch (error) {
                  console.error("[Notes] Failed to delete knowledge document:", error);
                  Alert.alert(
                    t("common.error", "错误"),
                    t("notes.knowledgeDocumentDeleteFailed", "知识文档删除失败"),
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [knowledgeDocuments, knowledgeHome?.id, selectedKnowledgeDocumentId, t],
  );

  const handleMoveKnowledgeDocument = useCallback(
    async (document: KnowledgeDocument, parentId?: string | null) => {
      const validation = validateKnowledgeDocumentParent(document.id, parentId, knowledgeDocuments);
      if (!validation.ok) {
        if (validation.reason !== "same_parent") {
          Alert.alert(
            t("common.error", "错误"),
            t("notes.knowledgeDocumentMoveInvalid", "不能移动到这个位置"),
          );
        }
        return;
      }

      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      try {
        const nextParentId = parentId || undefined;
        await updateKnowledgeDocument(document.id, { parentId: nextParentId });
        const updatedDocument: KnowledgeDocument = {
          ...document,
          parentId: nextParentId,
          updatedAt: Date.now(),
        };
        setKnowledgeDocuments((documents) =>
          orderKnowledgeDocuments(
            documents.map((item) => (item.id === document.id ? updatedDocument : item)),
            documents.find((item) => item.type === "book_home")?.id,
          ),
        );
        if (knowledgeHome?.id === document.id) {
          setKnowledgeHome(updatedDocument);
        }
      } catch (error) {
        console.error("[Notes] Failed to move knowledge document:", error);
        Alert.alert(
          t("common.error", "错误"),
          t("notes.knowledgeDocumentMoveFailed", "知识文档移动失败"),
        );
      }
    },
    [knowledgeDocuments, knowledgeHome?.id, saveActiveKnowledgeDocumentNow, t],
  );

  const handlePickKnowledgeImageAttachment = useCallback(
    async (document: KnowledgeDocument): Promise<MobileKnowledgeImageInsertAttrs | null> => {
      try {
        const result = await pickAndPersistMobileKnowledgeImageAttachment(document.id);
        return result?.attrs ?? null;
      } catch (error) {
        console.error("[Notes] Failed to add knowledge image attachment:", error);
        Alert.alert(
          t("common.error", "错误"),
          t("notes.knowledgeAttachmentAddFailed", "图片附件添加失败"),
        );
        return null;
      }
    },
    [t],
  );

  const handleCompressKnowledgeSummary = useCallback(async () => {
    if (!knowledgeHome || isKnowledgeSummaryCompressing) return;

    const resolvedAIConfig = await resolveActiveAIConfig(useSettingsStore.getState());
    if (!resolvedAIConfig) {
      Alert.alert(
        t("common.error", "错误"),
        t("notes.knowledgeSummaryAIConfigMissing", "请先配置可用的 AI 模型，再压缩知识记忆"),
      );
      return;
    }

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    const normalizedTags = normalizeKnowledgeTags(knowledgeTags);
    const liveDocument: KnowledgeDocument = {
      ...knowledgeHome,
      title: knowledgeTitle.trim() || knowledgeHome.title,
      contentJson: knowledgeValue.contentJson,
      contentMd: knowledgeValue.contentMd,
      excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
      tags: normalizedTags,
      updatedAt: Date.now(),
    };

    setIsKnowledgeSummaryCompressing(true);
    try {
      const result = await maybeCompressAndPersistKnowledgeSummary(liveDocument, resolvedAIConfig);

      if (result.status === "failed") {
        Alert.alert(
          t("common.error", "错误"),
          [t("notes.knowledgeSummaryFailed", "压缩记忆更新失败"), result.error]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }

      if (result.status === "skipped") {
        const message =
          result.plan.reason === "empty"
            ? t("notes.knowledgeSummaryEmpty", "这个文档还没有可摘要的内容")
            : result.plan.reason === "below_threshold"
              ? t("notes.knowledgeSummaryTooShort", "这个文档还比较短，暂不需要压缩记忆")
              : t("notes.knowledgeSummaryUpToDate", "压缩记忆已是最新");
        Alert.alert(t("notes.knowledgeSummaryMemory", "AI 记忆"), message);
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
      Alert.alert(
        t("common.success", "成功"),
        t("notes.knowledgeSummaryCompressed", "压缩记忆已更新"),
      );
    } catch (error) {
      console.error("[Notes] Failed to compress knowledge summary:", error);
      Alert.alert(t("common.error", "错误"), t("notes.knowledgeSummaryFailed", "压缩记忆更新失败"));
    } finally {
      setIsKnowledgeSummaryCompressing(false);
    }
  }, [
    isKnowledgeSummaryCompressing,
    knowledgeHome,
    knowledgeTags,
    knowledgeTitle,
    knowledgeValue,
    saveActiveKnowledgeDocumentNow,
    t,
  ]);

  const handleDeleteNote = useCallback(
    (highlight: HighlightWithBook) => {
      Alert.alert(t("common.confirm", "确认"), t("notes.deleteNoteConfirm", "确定删除此笔记？"), [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: () => {
            updateHighlight(highlight.id, { note: undefined });
          },
        },
      ]);
    },
    [updateHighlight, t],
  );

  const handleDeleteHighlight = useCallback(
    (highlight: HighlightWithBook) => {
      Alert.alert(
        t("common.confirm", "确认"),
        t("notes.deleteHighlightConfirm", "确定删除此高亮？"),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("common.delete", "删除"),
            style: "destructive",
            onPress: () => {
              removeHighlight(highlight.id);
            },
          },
        ],
      );
    },
    [removeHighlight, t],
  );

  const startEditNote = useCallback((highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  }, []);

  const saveNote = useCallback(
    (id: string) => {
      updateHighlight(id, { note: editNote || undefined });
      setEditingId(null);
      setEditNote("");
    },
    [updateHighlight, editNote],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditNote("");
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setShowExportMenu(false);
      if (!selectedBook) return;

      const book = books.find((b) => b.id === selectedBook.bookId);
      if (!book) return;

      const exporter = new AnnotationExporter();
      const content = exporter.export(selectedBook.highlights as Highlight[], [], book, { format });

      try {
        if (format === "notion") {
          await exporter.copyToClipboard(content);
          Alert.alert(t("common.success", "成功"), t("notes.copiedToClipboard", "已复制到剪贴板"));
        } else {
          const ext = format === "json" ? "json" : "md";
          await exporter.downloadAsFile(content, `${selectedBook.title}-${format}.${ext}`, format);
        }
      } catch (err) {
        console.error("Export failed:", err);
        Alert.alert(t("common.error", "错误"), t("notes.exportFailed", "导出失败"));
      }
    },
    [selectedBook, books, t],
  );

  const handleKnowledgeExport = useCallback(
    async (format: KnowledgeExportFormat) => {
      setShowExportMenu(false);
      if (!selectedBook || !knowledgeHome) return;

      const book = books.find((b) => b.id === selectedBook.bookId);
      if (!book) return;

      const exporter = new AnnotationExporter();
      const liveDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: knowledgeTitle.trim() || knowledgeHome.title,
        contentMd: knowledgeValue.contentMd,
        contentJson: knowledgeValue.contentJson,
        excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
        tags: normalizeKnowledgeTags(knowledgeTags),
        updatedAt: Date.now(),
      };
      try {
        const input = await collectBookKnowledgeExportInput(
          selectedBook.bookId,
          liveDocument,
          book,
        );
        const file = knowledgeExporter.exportBundle(input, {
          format,
          rootDir: "ReadAny",
          title: `${selectedBook.title} Knowledge`,
        });
        const filename =
          file.path.split("/").filter(Boolean).pop() || `${selectedBook.title}-knowledge.md`;
        await exporter.downloadAsFile(file.content, filename, format);
      } catch (err) {
        console.error("Knowledge export failed:", err);
        Alert.alert(t("common.error", "错误"), t("notes.exportFailed", "导出失败"));
      }
    },
    [selectedBook, knowledgeHome, knowledgeTitle, knowledgeTags, knowledgeValue, books, t],
  );

  const handleKnowledgeMarkdownImport = useCallback(async () => {
    setShowExportMenu(false);
    if (
      !selectedKnowledgeBookId ||
      isKnowledgeMarkdownImporting ||
      isKnowledgeMarkdownImportApplying
    ) {
      return;
    }

    setIsKnowledgeMarkdownImporting(true);
    setKnowledgeMarkdownImportReview(null);

    try {
      const platform = getPlatformService();
      const selected = await platform.pickFile({
        multiple: true,
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown"],
          },
        ],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      const items: KnowledgeMarkdownImportReviewItem[] = [];
      const defaultParentId = isKnowledgeVaultRootOpen
        ? undefined
        : knowledgeHome?.type === "folder"
          ? knowledgeHome.id
          : knowledgeHome?.parentId;
      for (const path of paths) {
        const content = await platform.readTextFile(path);
        const imported = parseKnowledgeMarkdownDocument({
          path,
          content,
          bookId: selectedKnowledgeBookId,
          defaultParentId,
        });
        items.push({
          path,
          proposal: createKnowledgeImportWriteProposal(imported, {
            message: t("notes.knowledgeMarkdownImportProposalMessage", {
              file: mobileFileName(path),
            }),
          }),
          warnings: imported.warnings,
        });
      }

      setKnowledgeMarkdownImportReview({ items });
    } catch (error) {
      console.error("[Notes] Knowledge Markdown import failed:", error);
      Alert.alert(
        t("common.error", "错误"),
        t("notes.knowledgeMarkdownImportFailed", "Markdown 文件导入失败"),
      );
    } finally {
      setIsKnowledgeMarkdownImporting(false);
    }
  }, [
    isKnowledgeMarkdownImportApplying,
    isKnowledgeMarkdownImporting,
    isKnowledgeVaultRootOpen,
    knowledgeHome?.id,
    knowledgeHome?.parentId,
    knowledgeHome?.type,
    saveActiveKnowledgeDocumentNow,
    selectedKnowledgeBookId,
    t,
  ]);

  const handleApplyKnowledgeMarkdownImport = useCallback(async () => {
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
      setKnowledgeMarkdownImportReview(null);
      Alert.alert(
        t("common.success", "成功"),
        t("notes.knowledgeMarkdownImportAppliedDetail", {
          count: knowledgeMarkdownImportReview.items.length,
        }),
      );
    } catch (error) {
      console.error("[Notes] Failed to apply knowledge Markdown import:", error);
      Alert.alert(
        t("common.error", "错误"),
        t("notes.knowledgeMarkdownImportApplyFailed", "应用 Markdown 导入失败"),
      );
    } finally {
      setIsKnowledgeMarkdownImportApplying(false);
    }
  }, [
    isKnowledgeMarkdownImportApplying,
    knowledgeHome?.id,
    knowledgeMarkdownImportReview,
    refreshSelectedKnowledgeDocuments,
    saveActiveKnowledgeDocumentNow,
    t,
  ]);

  const totalHighlights = stats?.totalHighlights ?? 0;
  const totalNotes = stats?.highlightsWithNotes ?? 0;
  const totalBooks = stats?.totalBooks ?? 0;

  // Loading
  if (isLoading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={s.loadingWrap}>
          <View style={s.spinner} />
          <Text style={s.loadingText}>{t("common.loading", "加载中...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Empty
  if (bookNotebooks.length === 0) {
    return (
      <SafeAreaView
        style={[s.container, { backgroundColor: colors.background }]}
        edges={hideDetailHeader ? [] : ["top"]}
      >
        {!hideDetailHeader && (
          <View style={s.header}>
            <Text style={s.headerTitle}>{t("notes.title", "笔记")}</Text>
          </View>
        )}
        <View style={s.emptyWrap}>
          <Image source={isDark ? NOTE_DARK_PNG : NOTE_PNG} style={{ width: 160, height: 160 }} />
          <Text style={s.emptyTitle}>{t("notes.empty", "暂无笔记")}</Text>
          <Text style={s.emptyHint}>{t("notes.emptyHint", "阅读时长按文字添加高亮和笔记")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Detail view
  if (selectedBookId && selectedBook) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
        {/* Detail header - hide entirely when from reader and empty */}
        {!(hideDetailHeader && selectedBook.highlights.length === 0) && (
          <View style={s.detailHeader}>
            {!hideDetailHeader && (
              <View style={s.detailHeaderTop}>
                {/* Back button - return to list when in tab navigation */}
                {showBackButton && (
                  <TouchableOpacity style={s.backBtn} onPress={() => setSelectedBookId(null)}>
                    <ChevronLeftIcon size={20} color={colors.foreground} />
                  </TouchableOpacity>
                )}

                {/* Book cover */}
                {resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl ? (
                  <Image
                    source={{
                      uri: resolvedCovers.get(selectedBook.bookId) || selectedBook.coverUrl || "",
                    }}
                    style={s.detailCover}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={s.detailCoverFallback}>
                    <BookOpenIcon size={16} color={colors.mutedForeground} />
                  </View>
                )}

                <View style={s.detailHeaderInfo}>
                  <Text style={s.detailTitle} numberOfLines={1}>
                    {selectedBook.title}
                  </Text>
                  <Text style={s.detailAuthor}>{selectedBook.author}</Text>
                </View>

                {/* Export button */}
                <TouchableOpacity
                  style={s.exportBtn}
                  onPress={() => setShowExportMenu(!showExportMenu)}
                >
                  <ShareIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            )}

            {/* Tabs + search */}
            <View style={s.detailTabRow}>
              <View style={s.tabSwitcher}>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "knowledge" && s.tabBtnActive]}
                  onPress={() => setDetailTab("knowledge")}
                >
                  <ScrollTextIcon
                    size={12}
                    color={
                      detailTab === "knowledge" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "knowledge" && s.tabBtnTextActive]}>
                    {t("notes.knowledgeTab", "知识主页")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "notes" && s.tabBtnActive]}
                  onPress={() => setDetailTab("notes")}
                >
                  <NotebookPenIcon
                    size={12}
                    color={
                      detailTab === "notes" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "notes" && s.tabBtnTextActive]}>
                    {t("notebook.notesSection", "笔记")} ({selectedBook.notesCount || 0})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.tabBtn, detailTab === "highlights" && s.tabBtnActive]}
                  onPress={() => setDetailTab("highlights")}
                >
                  <HighlighterIcon
                    size={12}
                    color={
                      detailTab === "highlights" ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text style={[s.tabBtnText, detailTab === "highlights" && s.tabBtnTextActive]}>
                    {t("notebook.highlightsSection", "高亮")} (
                    {selectedBook.highlightsOnlyCount || 0})
                  </Text>
                </TouchableOpacity>
              </View>

              {detailTab === "knowledge" ? (
                <View style={s.knowledgeStatusBar}>
                  <Text style={s.knowledgeStatusMeta}>
                    {knowledgeDocuments.length} {t("notes.knowledgeDocuments", "文档")}
                  </Text>
                  <Text style={s.knowledgeStatusMeta}>
                    {selectedBook.highlights.length} {t("notes.highlightsCount", "条高亮")}
                  </Text>
                </View>
              ) : (
                <View style={s.detailSearch}>
                  <SearchIcon size={14} color={colors.mutedForeground} />
                  <TextInput
                    style={s.detailSearchInput}
                    placeholder={t("notes.searchPlaceholder", "搜索...")}
                    placeholderTextColor={colors.mutedForeground}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                </View>
              )}
            </View>
          </View>
        )}

        {/* Detail content */}
        {detailTab === "knowledge" ? (
          <KnowledgeHomePanel
            key={knowledgeHome?.id ?? selectedBook.bookId}
            book={selectedBook}
            document={knowledgeHome}
            documents={knowledgeDocuments}
            isVaultRootOpen={isKnowledgeVaultRootOpen}
            activeDocumentId={isKnowledgeVaultRootOpen ? "__vault__" : selectedKnowledgeDocumentId}
            title={knowledgeTitle}
            tags={knowledgeTags}
            value={knowledgeValue}
            links={knowledgeLinks}
            backlinks={knowledgeBacklinks}
            isRelationsLoading={isKnowledgeRelationsLoading}
            isLoading={isKnowledgeLoading}
            isCreatingDocument={isKnowledgeDocumentCreating}
            isSaved={currentKnowledgeFingerprint === savedKnowledgeFingerprint}
            isSaving={isKnowledgeSaving}
            isSummaryCompressing={isKnowledgeSummaryCompressing}
            onTitleChange={setKnowledgeTitle}
            onTagsChange={setKnowledgeTags}
            onChange={setKnowledgeValue}
            onOpenVaultRoot={openKnowledgeVaultRoot}
            onSelectDocument={openKnowledgeDocument}
            onCreateDocument={handleCreateKnowledgeDocument}
            onDeleteDocument={handleDeleteKnowledgeDocument}
            onMoveDocument={handleMoveKnowledgeDocument}
            onCompressSummary={handleCompressKnowledgeSummary}
            onPickImageAttachment={handlePickKnowledgeImageAttachment}
            onOpenBook={(cfi) => handleOpenBook(selectedBook.bookId, cfi)}
            t={t}
            styles={s}
            colors={colors}
          />
        ) : currentList.length === 0 ? (
          <View style={s.detailEmpty}>
            <Text style={s.detailEmptyText}>
              {searchQuery
                ? t("notes.noSearchResults", "没有匹配结果")
                : detailTab === "notes"
                  ? t("notes.noNotes", "暂无笔记")
                  : t("highlights.noHighlights", "暂无高亮")}
            </Text>
          </View>
        ) : (
          <ScrollView style={s.detailList} showsVerticalScrollIndicator={false}>
            {itemsByChapter.map(({ chapter, items }) => (
              <View key={chapter} style={s.chapterGroup}>
                {/* Chapter divider */}
                <View style={s.chapterDivider}>
                  <View style={s.chapterLine} />
                  <Text style={s.chapterName}>{chapter}</Text>
                  <View style={s.chapterLine} />
                </View>

                {items.map((item) =>
                  detailTab === "notes" ? (
                    <NoteCard
                      key={item.id}
                      highlight={item}
                      isEditing={editingId === item.id}
                      editNote={editNote}
                      setEditNote={setEditNote}
                      onStartEdit={() => startEditNote(item)}
                      onSaveNote={() => saveNote(item.id)}
                      onCancelEdit={cancelEdit}
                      onDeleteNote={() => handleDeleteNote(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                      t={t}
                    />
                  ) : (
                    <HighlightCard
                      key={item.id}
                      highlight={item}
                      onDelete={() => handleDeleteHighlight(item)}
                      onNavigate={() => handleOpenBook(selectedBook.bookId, item.cfi)}
                    />
                  ),
                )}
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        )}

        {/* Export menu */}
        <Modal
          visible={showExportMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowExportMenu(false)}
        >
          <Pressable style={s.exportOverlay} onPress={() => setShowExportMenu(false)} />
          <View style={s.exportDropdown}>
            {detailTab === "knowledge" ? (
              <>
                {(["obsidian", "markdown"] as const).map((fmt) => (
                  <TouchableOpacity
                    key={fmt}
                    style={s.exportItem}
                    onPress={() => handleKnowledgeExport(fmt)}
                  >
                    <Text style={s.exportItemText}>
                      {fmt === "obsidian"
                        ? t("notes.exportObsidian", "Obsidian")
                        : t("notes.exportMarkdown", "Markdown")}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={s.exportDivider} />
                <TouchableOpacity
                  style={[
                    s.exportItem,
                    (isKnowledgeMarkdownImporting || isKnowledgeMarkdownImportApplying) &&
                      s.exportItemDisabled,
                  ]}
                  onPress={handleKnowledgeMarkdownImport}
                  disabled={isKnowledgeMarkdownImporting || isKnowledgeMarkdownImportApplying}
                >
                  <Text style={s.exportItemText}>
                    {isKnowledgeMarkdownImporting
                      ? t("notes.knowledgeMarkdownImporting", "读取中...")
                      : t("notes.knowledgeImportMarkdown", "导入 Markdown 文件")}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              (["markdown", "json", "obsidian", "notion"] as const).map((fmt) => (
                <TouchableOpacity key={fmt} style={s.exportItem} onPress={() => handleExport(fmt)}>
                  <Text style={s.exportItemText}>
                    {fmt === "markdown"
                      ? t("notes.exportMarkdown", "Markdown")
                      : fmt === "json"
                        ? t("notes.exportJSON", "JSON")
                        : fmt === "obsidian"
                          ? t("notes.exportObsidian", "Obsidian")
                          : t("notes.exportNotion", "Notion")}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </Modal>

        <KnowledgeMarkdownImportReviewSheet
          review={knowledgeMarkdownImportReview}
          documents={knowledgeDocuments}
          isApplying={isKnowledgeMarkdownImportApplying}
          onApply={handleApplyKnowledgeMarkdownImport}
          onDismiss={() => setKnowledgeMarkdownImportReview(null)}
          t={t}
          styles={s}
          colors={colors}
        />
      </SafeAreaView>
    );
  }

  // Main list view
  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={edges}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={s.headerTitle}>{t("notes.title", "笔记")}</Text>
            <SyncButton size={18} color={colors.mutedForeground} />
          </View>
          {bookNotebooks.length > 0 && (
            <TouchableOpacity
              style={s.searchToggle}
              onPress={() => {
                setShowSearch(!showSearch);
                if (showSearch) setSearchQuery("");
              }}
            >
              {showSearch ? (
                <XIcon size={18} color={colors.mutedForeground} />
              ) : (
                <SearchIcon size={18} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statBadge}>
            <HighlighterIcon size={14} color={colors.amber} />
            <Text style={s.statValue}>{totalHighlights}</Text>
            <Text style={s.statLabel}>{t("notebook.highlightsSection", "高亮")}</Text>
          </View>
          <View style={s.statBadge}>
            <NotebookPenIcon size={14} color={colors.blue} />
            <Text style={s.statValue}>{totalNotes}</Text>
            <Text style={s.statLabel}>{t("notebook.notesSection", "笔记")}</Text>
          </View>
          <View style={s.statBadge}>
            <BookOpenIcon size={14} color={colors.emerald} />
            <Text style={s.statValue}>{totalBooks}</Text>
            <Text style={s.statLabel}>{t("profile.booksUnit", "本")}</Text>
          </View>
        </View>

        {showSearch && (
          <View style={s.searchBar}>
            <SearchIcon size={14} color={colors.mutedForeground} />
            <TextInput
              style={s.searchInput}
              placeholder={t("notes.searchPlaceholder", "搜索笔记...")}
              placeholderTextColor={colors.mutedForeground}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <XIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Notebook list */}
      <FlatList
        data={bookNotebooks}
        keyExtractor={(item) => item.bookId}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <NotebookCard
            book={item}
            resolvedCoverUrl={resolvedCovers.get(item.bookId)}
            onPress={() => {
              setSelectedBookId(item.bookId);
              setSearchQuery("");
              setEditingId(null);
              setDetailTab("knowledge");
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}

function KnowledgeHomePanel({
  book,
  document,
  documents,
  isVaultRootOpen,
  activeDocumentId,
  title,
  tags,
  value,
  links,
  backlinks,
  isRelationsLoading,
  isLoading,
  isCreatingDocument,
  isSaved,
  isSaving,
  isSummaryCompressing,
  onTitleChange,
  onTagsChange,
  onChange,
  onOpenVaultRoot,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  onMoveDocument,
  onCompressSummary,
  onPickImageAttachment,
  onOpenBook,
  t,
  styles,
  colors,
}: {
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
  isVaultRootOpen: boolean;
  activeDocumentId: string | null;
  title: string;
  tags: string[];
  value: MobileKnowledgeEditorValue;
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  isRelationsLoading: boolean;
  isLoading: boolean;
  isCreatingDocument: boolean;
  isSaved: boolean;
  isSaving: boolean;
  isSummaryCompressing: boolean;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string[]) => void;
  onChange: (value: MobileKnowledgeEditorValue) => void;
  onOpenVaultRoot: () => void;
  onSelectDocument: (document: KnowledgeDocument) => void;
  onCreateDocument: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onDeleteDocument: (document: KnowledgeDocument) => void;
  onMoveDocument: (document: KnowledgeDocument, parentId?: string | null) => void;
  onCompressSummary: () => void;
  onPickImageAttachment: (
    document: KnowledgeDocument,
  ) => Promise<MobileKnowledgeImageInsertAttrs | null>;
  onOpenBook: (cfi?: string) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const recentHighlights = useMemo(
    () => sortAnnotationsByPosition(book.highlights).slice(0, 3),
    [book.highlights],
  );
  const isFolderDocument = !isVaultRootOpen && document?.type === "folder";
  const rootDocuments = useMemo(() => {
    const homeDocumentId = documents.find((item) => item.type === "book_home")?.id;
    return orderKnowledgeDocuments(
      documents.filter((item) => !item.parentId),
      homeDocumentId,
    );
  }, [documents]);
  const folderChildren = useMemo(() => {
    if (!document || isVaultRootOpen || document.type !== "folder") return [];
    return orderKnowledgeDocuments(
      documents.filter((item) => item.parentId === document.id),
      undefined,
    );
  }, [document, documents, isVaultRootOpen]);
  const activePathItems = useMemo(
    () =>
      isVaultRootOpen
        ? [{ id: "__vault__", title: t("notes.knowledgeVaultRoot", "知识库") }]
        : document
          ? knowledgeDocumentPathItems(document, documents, t, title)
          : [{ id: "__vault__", title: t("notes.knowledgeVaultRoot", "知识库") }],
    [document, documents, isVaultRootOpen, t, title],
  );
  const activePath = useMemo(
    () => activePathItems.map((item) => item.title).join(" / "),
    [activePathItems],
  );
  const activePathLastId = activePathItems.at(-1)?.id;
  const documentOutline = useMemo(
    () =>
      document && !isVaultRootOpen && !isFolderDocument
        ? extractKnowledgeDocumentOutline(value.contentJson, value.contentMd)
        : [],
    [document, isFolderDocument, isVaultRootOpen, value.contentJson, value.contentMd],
  );
  const internalLinkTargets = useMemo<MobileKnowledgeInternalLinkTarget[]>(
    () =>
      documents
        .filter((item) => item.id !== document?.id)
        .map((item) => {
          const path = knowledgeDocumentPathItems(item, documents, t)
            .slice(1, -1)
            .map((part) => part.title)
            .join(" / ");
          return {
            id: item.id,
            title: item.title.trim() || t("notes.knowledgeUntitledDocument", "未命名文档"),
            path,
            typeLabel: knowledgeDocumentTypeLabel(item, t),
          };
        }),
    [document?.id, documents, t],
  );
  const [outlineTarget, setOutlineTarget] = useState<MobileKnowledgeEditorOutlineTarget | null>(
    null,
  );
  const [workspaceMode, setWorkspaceMode] = useState<MobileKnowledgeWorkspaceMode>("vault");
  const [isContextSheetVisible, setIsContextSheetVisible] = useState(false);
  const [actionDocument, setActionDocument] = useState<KnowledgeDocument | null>(null);
  const [moveDocument, setMoveDocument] = useState<KnowledgeDocument | null>(null);
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of documents) {
      if (!item.parentId) continue;
      counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const getMoveTargets = useCallback(
    (targetDocument: KnowledgeDocument) => {
      if (targetDocument.type === "book_home") return [];
      const homeDocumentId = documents.find((item) => item.type === "book_home")?.id;
      const tree = buildKnowledgeDocumentTree(documents, homeDocumentId);
      const folderTargets = flattenKnowledgeDocumentTree(tree.roots)
        .filter((node) => node.document.type === "folder")
        .map((node) => ({
          id: node.document.id,
          title: node.document.title.trim() || t("notes.knowledgeUntitledDocument", "未命名文档"),
          depth: node.depth + 1,
        }));

      return [
        { id: undefined, title: t("notes.knowledgeMoveRoot", "根目录"), depth: 0 },
        ...folderTargets,
      ].filter(
        (target) => validateKnowledgeDocumentParent(targetDocument.id, target.id, documents).ok,
      );
    },
    [documents, t],
  );
  const currentDocumentMoveTargets = useMemo(
    () => (document ? getMoveTargets(document) : []),
    [document, getMoveTargets],
  );
  const moveTargets = useMemo(
    () => (moveDocument ? getMoveTargets(moveDocument) : []),
    [getMoveTargets, moveDocument],
  );
  const actionDocumentChildCount = actionDocument
    ? (childCountByParentId.get(actionDocument.id) ?? 0)
    : 0;
  const canDeleteActionDocument =
    !!actionDocument &&
    canDeleteKnowledgeDocument(actionDocument) &&
    !(actionDocument.type === "folder" && actionDocumentChildCount > 0);
  const canMoveActionDocument = !!actionDocument && getMoveTargets(actionDocument).length > 0;

  const showMovePicker = useCallback(
    (targetDocument?: KnowledgeDocument | null) => {
      if (!targetDocument || getMoveTargets(targetDocument).length === 0) return;
      setActionDocument(null);
      setMoveDocument(targetDocument);
    },
    [getMoveTargets],
  );

  const handleMoveToTarget = useCallback(
    (targetId?: string) => {
      if (!moveDocument) return;
      setMoveDocument(null);
      onMoveDocument(moveDocument, targetId);
    },
    [moveDocument, onMoveDocument],
  );

  const handleSelectKnowledgeDocument = useCallback(
    (nextDocument: KnowledgeDocument) => {
      onSelectDocument(nextDocument);
      setWorkspaceMode(nextDocument.type === "folder" ? "vault" : "document");
    },
    [onSelectDocument],
  );
  const handleSelectContextDocument = useCallback(
    (nextDocument: KnowledgeDocument) => {
      setIsContextSheetVisible(false);
      handleSelectKnowledgeDocument(nextDocument);
    },
    [handleSelectKnowledgeDocument],
  );
  const handleOpenBookFromContext = useCallback(
    (cfi?: string) => {
      setIsContextSheetVisible(false);
      onOpenBook(cfi);
    },
    [onOpenBook],
  );
  const handleSelectOutlineItem = useCallback((item: KnowledgeDocumentOutlineItem) => {
    setIsContextSheetVisible(false);
    setWorkspaceMode("document");
    setOutlineTarget((current) => ({
      index: item.index,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, []);

  useEffect(() => {
    if (document?.type === "folder" && workspaceMode === "document") {
      setWorkspaceMode("vault");
    }
  }, [document?.type, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "document") {
      setIsContextSheetVisible(false);
    }
  }, [workspaceMode]);

  if (isLoading || !document) {
    return (
      <View style={styles.knowledgeLoading}>
        <View style={styles.spinner} />
        <Text style={styles.loadingText}>{t("notes.knowledgeLoading", "正在打开知识主页...")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.knowledgeRoot}>
      {workspaceMode === "vault" ? (
        <ScrollView
          style={styles.knowledgeScroll}
          contentContainerStyle={styles.knowledgeContent}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.knowledgeVaultHeader}>
            <View style={styles.knowledgeVaultText}>
              <Text style={styles.knowledgeVaultEyebrow}>
                {t("notes.knowledgeEyebrow", "知识库")}
              </Text>
              <Text style={styles.knowledgeVaultTitle} numberOfLines={1}>
                {book.title}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.knowledgeVaultPathScroll}
                contentContainerStyle={styles.knowledgeVaultPathTrail}
              >
                {activePathItems.map((part, index) => {
                  const isLastPathPart = part.id === activePathLastId;
                  const isRootPathPart = part.id === "__vault__";
                  const targetDocument = documents.find((item) => item.id === part.id);
                  return (
                    <View key={part.id} style={styles.knowledgeVaultPathSegment}>
                      {index > 0 ? <Text style={styles.knowledgeVaultPathSlash}>/</Text> : null}
                      <TouchableOpacity
                        activeOpacity={
                          (targetDocument || isRootPathPart) && !isLastPathPart ? 0.76 : 1
                        }
                        style={[
                          styles.knowledgeVaultPathChip,
                          isLastPathPart && styles.knowledgeVaultPathChipActive,
                        ]}
                        onPress={() => {
                          if (isLastPathPart) return;
                          if (isRootPathPart) {
                            void onOpenVaultRoot();
                            return;
                          }
                          if (!targetDocument) return;
                          handleSelectKnowledgeDocument(targetDocument);
                        }}
                        disabled={(!targetDocument && !isRootPathPart) || isLastPathPart}
                      >
                        <Text
                          style={[
                            styles.knowledgeVaultPathChipText,
                            isLastPathPart && styles.knowledgeVaultPathChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {part.title}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          <KnowledgeDocumentExplorer
            documents={documents}
            activeDocument={isVaultRootOpen ? null : document}
            activeDocumentId={activeDocumentId}
            isRootActive={isVaultRootOpen}
            isCreating={isCreatingDocument}
            onSelectRoot={onOpenVaultRoot}
            onSelect={handleSelectKnowledgeDocument}
            onCreate={onCreateDocument}
            t={t}
            styles={styles}
            colors={colors}
          />

          {isVaultRootOpen ? (
            <KnowledgeVaultRootOverview
              items={rootDocuments}
              documents={documents}
              isCreating={isCreatingDocument}
              onSelect={handleSelectKnowledgeDocument}
              onCreate={onCreateDocument}
              onOpenActions={setActionDocument}
              t={t}
              styles={styles}
              colors={colors}
            />
          ) : isFolderDocument ? (
            <KnowledgeFolderOverview
              folder={document}
              items={folderChildren}
              documents={documents}
              isCreating={isCreatingDocument}
              onSelect={handleSelectKnowledgeDocument}
              onCreate={onCreateDocument}
              onOpenActions={setActionDocument}
              t={t}
              styles={styles}
              colors={colors}
            />
          ) : null}
        </ScrollView>
      ) : (
        <View style={[styles.knowledgeDocumentScreen, styles.knowledgeDocumentFullScreen]}>
          <View style={styles.knowledgeDocumentCanvasHeader}>
            <TouchableOpacity
              activeOpacity={0.76}
              style={styles.knowledgeDocumentBackButton}
              onPress={() => setWorkspaceMode("vault")}
              accessibilityRole="button"
              accessibilityLabel={t("notes.knowledgeWorkspaceVault", "目录")}
            >
              <ChevronLeftIcon size={18} color={colors.foreground} />
            </TouchableOpacity>

            <View style={styles.knowledgeDocumentCanvasTitleBlock}>
              <TextInput
                value={title}
                onChangeText={onTitleChange}
                placeholder={t("notes.knowledgeUntitledDocument", "未命名文档")}
                placeholderTextColor={colors.mutedForeground}
                style={styles.knowledgeCanvasTitleInput}
                returnKeyType="done"
              />
              <Text style={styles.knowledgeCanvasPath} numberOfLines={1}>
                {activePath}
              </Text>
            </View>

            <View style={styles.knowledgeDocumentActionRail}>
              <View style={styles.knowledgeCanvasStatus}>
                <CheckCheckIcon size={13} color={colors.mutedForeground} />
              </View>
              <TouchableOpacity
                activeOpacity={0.78}
                style={styles.knowledgeCanvasIconButton}
                onPress={() => setIsContextSheetVisible(true)}
                accessibilityLabel={t("notes.knowledgeContext", "上下文")}
              >
                <BrainIcon size={14} color={colors.foreground} />
              </TouchableOpacity>
              {currentDocumentMoveTargets.length > 0 ? (
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={styles.knowledgeCanvasIconButton}
                  onPress={() => showMovePicker(document)}
                  accessibilityLabel={t("notes.knowledgeMoveDocument", "移动文档")}
                >
                  <FolderInputIcon size={14} color={colors.foreground} />
                </TouchableOpacity>
              ) : null}
              {canDeleteKnowledgeDocument(document) ? (
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={styles.knowledgeCanvasIconButton}
                  onPress={() => onDeleteDocument(document)}
                  accessibilityLabel={t("notes.knowledgeDeleteDocument", "删除文档")}
                >
                  <Trash2Icon size={14} color={colors.destructive} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <Text style={styles.knowledgeCanvasSaveText}>
            {isSaving
              ? t("notes.knowledgeSaving", "保存中")
              : isSaved
                ? t("notes.knowledgeSaved", "已保存")
                : t("notes.knowledgePending", "待保存")}
          </Text>

          <View style={styles.knowledgeDocumentCanvas}>
            <MobileKnowledgeEditor
              tier="knowledge_doc"
              surface={getKnowledgeEditorSurfaceForDocumentType(document.type)}
              documentId={document.id}
              value={value}
              onChange={onChange}
              layout="document"
              onPickLocalImage={() => onPickImageAttachment(document)}
              isSaved={isSaved}
              outlineTarget={outlineTarget}
              internalLinkTargets={internalLinkTargets}
              placeholder={t(
                "notes.knowledgePlaceholder",
                "记录这本书的摘要、问题、想法和长期知识...",
              )}
            />
          </View>
        </View>
      )}

      <Modal
        visible={!!moveDocument}
        transparent
        animationType="fade"
        onRequestClose={() => setMoveDocument(null)}
      >
        <Pressable
          style={styles.knowledgeMoveSheetBackdrop}
          onPress={() => setMoveDocument(null)}
        />
        <View style={styles.knowledgeMoveSheet}>
          <View style={styles.knowledgeMoveSheetHeader}>
            <View style={styles.knowledgeMoveSheetTitleBlock}>
              <Text style={styles.knowledgeMoveSheetTitle}>
                {t("notes.knowledgeMoveTo", "移动到")}
              </Text>
              <Text style={styles.knowledgeMoveSheetSubtitle} numberOfLines={1}>
                {moveDocument?.title || t("notes.knowledgeUntitledDocument", "未命名文档")}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.76}
              style={styles.knowledgeMoveSheetClose}
              onPress={() => setMoveDocument(null)}
              accessibilityLabel={t("common.cancel", "取消")}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.knowledgeMoveTargetScroll}
            contentContainerStyle={styles.knowledgeMoveTargetList}
            showsVerticalScrollIndicator={false}
          >
            {moveTargets.map((target) => (
              <TouchableOpacity
                key={target.id ?? "__root__"}
                activeOpacity={0.78}
                style={[
                  styles.knowledgeMoveTarget,
                  { paddingLeft: 12 + Math.min(target.depth, 5) * 14 },
                ]}
                onPress={() => handleMoveToTarget(target.id)}
              >
                <View style={styles.knowledgeMoveTargetIcon}>
                  {target.id ? (
                    <FolderIcon size={15} color={colors.foreground} />
                  ) : (
                    <FolderInputIcon size={15} color={colors.primary} />
                  )}
                </View>
                <Text style={styles.knowledgeMoveTargetText} numberOfLines={1}>
                  {target.title}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={!!actionDocument}
        transparent
        animationType="fade"
        onRequestClose={() => setActionDocument(null)}
      >
        <Pressable
          style={styles.knowledgeMoveSheetBackdrop}
          onPress={() => setActionDocument(null)}
        />
        <View style={styles.knowledgeMoveSheet}>
          <View style={styles.knowledgeMoveSheetHeader}>
            <View style={styles.knowledgeMoveSheetTitleBlock}>
              <Text style={styles.knowledgeMoveSheetTitle}>
                {actionDocument?.title || t("notes.knowledgeUntitledDocument", "未命名文档")}
              </Text>
              <Text style={styles.knowledgeMoveSheetSubtitle} numberOfLines={1}>
                {actionDocument ? knowledgeDocumentTypeLabel(actionDocument, t) : ""}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.76}
              style={styles.knowledgeMoveSheetClose}
              onPress={() => setActionDocument(null)}
              accessibilityLabel={t("common.cancel", "取消")}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {actionDocument ? (
            <View style={[styles.knowledgeMoveTargetList, styles.knowledgeCreateTargetList]}>
              <TouchableOpacity
                activeOpacity={0.78}
                style={styles.knowledgeMoveTarget}
                onPress={() => {
                  const target = actionDocument;
                  setActionDocument(null);
                  handleSelectKnowledgeDocument(target);
                }}
              >
                <View style={styles.knowledgeMoveTargetIcon}>
                  {actionDocument.type === "folder" ? (
                    <FolderIcon size={15} color={colors.foreground} />
                  ) : (
                    <ScrollTextIcon size={15} color={colors.foreground} />
                  )}
                </View>
                <Text style={styles.knowledgeMoveTargetText} numberOfLines={1}>
                  {t("notes.knowledgeOpenDocument", "打开文档")}
                </Text>
                <ChevronRightIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>

              {canMoveActionDocument ? (
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={styles.knowledgeMoveTarget}
                  onPress={() => showMovePicker(actionDocument)}
                >
                  <View style={styles.knowledgeMoveTargetIcon}>
                    <FolderInputIcon size={15} color={colors.primary} />
                  </View>
                  <Text style={styles.knowledgeMoveTargetText} numberOfLines={1}>
                    {t("notes.knowledgeMoveDocument", "移动文档")}
                  </Text>
                  <ChevronRightIcon size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              ) : null}

              {canDeleteActionDocument ? (
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={styles.knowledgeMoveTarget}
                  onPress={() => {
                    const target = actionDocument;
                    setActionDocument(null);
                    onDeleteDocument(target);
                  }}
                >
                  <View style={styles.knowledgeMoveTargetIcon}>
                    <Trash2Icon size={15} color={colors.destructive} />
                  </View>
                  <Text
                    style={[styles.knowledgeMoveTargetText, styles.knowledgeMoveTargetDangerText]}
                    numberOfLines={1}
                  >
                    {t("notes.knowledgeDeleteDocument", "删除文档")}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
      <Modal
        visible={isContextSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsContextSheetVisible(false)}
      >
        <Pressable
          style={styles.knowledgeMoveSheetBackdrop}
          onPress={() => setIsContextSheetVisible(false)}
        />
        <View style={styles.knowledgeContextSheet}>
          <View style={styles.knowledgeContextSheetHandle} />
          <View style={styles.knowledgeContextSheetHeader}>
            <View style={styles.knowledgeContextSheetTitleBlock}>
              <Text style={styles.knowledgeContextSheetTitle}>
                {t("notes.knowledgeContext", "上下文")}
              </Text>
              <Text style={styles.knowledgeContextSheetSubtitle} numberOfLines={1}>
                {title || t("notes.knowledgeUntitledDocument", "未命名文档")}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.76}
              style={styles.knowledgeMoveSheetClose}
              onPress={() => setIsContextSheetVisible(false)}
              accessibilityLabel={t("common.cancel", "取消")}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.knowledgeContextSheetScroll}
            contentContainerStyle={styles.knowledgeContextSheetContent}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <KnowledgeTagEditor tags={tags} onChange={onTagsChange} t={t} styles={styles} />

            {!isFolderDocument ? (
              <KnowledgeDocumentOutlineCard
                outline={documentOutline}
                onSelectItem={handleSelectOutlineItem}
                t={t}
                styles={styles}
                colors={colors}
              />
            ) : null}

            <KnowledgeRelationsCard
              links={links}
              backlinks={backlinks}
              documents={documents}
              highlights={book.highlights}
              isLoading={isRelationsLoading}
              onSelectDocument={handleSelectContextDocument}
              onOpenBook={handleOpenBookFromContext}
              t={t}
              styles={styles}
            />

            <KnowledgeSummaryMemoryCard
              document={document}
              isCompressing={isSummaryCompressing}
              onCompress={onCompressSummary}
              t={t}
              styles={styles}
              colors={colors}
            />

            <View style={styles.knowledgeSourcesCard}>
              <View style={styles.knowledgeSourcesHeader}>
                <Text style={styles.knowledgeSectionTitle}>
                  {t("notes.knowledgeRecentExcerpts", "最近摘录")}
                </Text>
                <TouchableOpacity
                  style={styles.knowledgeOpenButton}
                  onPress={() => handleOpenBookFromContext()}
                >
                  <Text style={styles.knowledgeOpenButtonText}>
                    {t("notes.openBook", "打开书籍")}
                  </Text>
                </TouchableOpacity>
              </View>

              {recentHighlights.length === 0 ? (
                <Text style={styles.knowledgeEmptySources}>
                  {t("notes.knowledgeNoSources", "暂无摘录")}
                </Text>
              ) : (
                <View style={styles.knowledgeSourceList}>
                  {recentHighlights.map((highlight) => (
                    <TouchableOpacity
                      key={highlight.id}
                      style={styles.knowledgeSourceItem}
                      activeOpacity={0.75}
                      onPress={() => handleOpenBookFromContext(highlight.cfi)}
                    >
                      <Text style={styles.knowledgeSourceText} numberOfLines={3}>
                        "{highlight.text}"
                      </Text>
                      {!!highlight.chapterTitle && (
                        <Text style={styles.knowledgeSourceChapter} numberOfLines={1}>
                          {highlight.chapterTitle}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function KnowledgeTagEditor({
  tags,
  onChange,
  t,
  styles,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = useCallback(
    (rawValue = draft) => {
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
    },
    [draft, onChange, tags],
  );

  return (
    <View style={styles.knowledgeTagWrap}>
      <Text style={styles.knowledgeTagLabel}>{t("notes.knowledgeTags", "标签")}</Text>
      <View style={styles.knowledgeTagRow}>
        {tags.map((tag) => (
          <TouchableOpacity
            key={tag}
            activeOpacity={0.75}
            style={styles.knowledgeTagChip}
            onPress={() => onChange(tags.filter((item) => item !== tag))}
            accessibilityLabel={t("notes.knowledgeTagRemove", { tag })}
          >
            <Text style={styles.knowledgeTagText} numberOfLines={1}>
              {tag}
            </Text>
            <Text style={styles.knowledgeTagRemove}>×</Text>
          </TouchableOpacity>
        ))}
        <TextInput
          value={draft}
          onChangeText={(text) => {
            if (/[,\uFF0C]/.test(text)) {
              commitDraft(text);
              return;
            }
            setDraft(text);
          }}
          onSubmitEditing={() => commitDraft()}
          onBlur={() => commitDraft()}
          placeholder={t("notes.knowledgeTagPlaceholder", "添加标签")}
          placeholderTextColor={styles.knowledgeTagInputPlaceholder.color}
          style={styles.knowledgeTagInput}
          returnKeyType="done"
        />
      </View>
    </View>
  );
}

function KnowledgeDocumentOutlineCard({
  outline,
  onSelectItem,
  t,
  styles,
  colors,
}: {
  outline: KnowledgeDocumentOutlineItem[];
  onSelectItem: (item: KnowledgeDocumentOutlineItem) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.knowledgeSourcesCard}>
      <View style={styles.knowledgeSourcesHeader}>
        <View style={styles.knowledgeOutlineTitleWrap}>
          <ListIcon size={15} color={colors.primary} />
          <Text style={styles.knowledgeSectionTitle}>
            {t("notes.knowledgeDocumentOutline", "文档大纲")}
          </Text>
        </View>
        {outline.length > 0 ? (
          <Text style={styles.knowledgeRelationLoading}>{outline.length}</Text>
        ) : null}
      </View>

      {outline.length === 0 ? (
        <Text style={styles.knowledgeEmptySources}>
          {t("notes.knowledgeDocumentOutlineEmpty", "添加标题后，这里会形成文档目录")}
        </Text>
      ) : (
        <View style={styles.knowledgeOutlineList}>
          {outline.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.knowledgeOutlineRow,
                { paddingLeft: 10 + Math.min(item.level - 1, 4) * 12 },
              ]}
              activeOpacity={0.74}
              onPress={() => onSelectItem(item)}
              accessibilityRole="button"
              accessibilityLabel={`${t("notes.knowledgeDocumentOutline", "文档大纲")} ${item.title}`}
            >
              <View style={styles.knowledgeOutlineDot} />
              <Text style={styles.knowledgeOutlineLevel}>H{item.level}</Text>
              <Text style={styles.knowledgeOutlineText} numberOfLines={1}>
                {item.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function knowledgeLinkTargetLabel(
  link: KnowledgeLink,
  highlights: HighlightWithBook[],
  t: TFunction,
): { title: string; detail: string; cfi?: string } {
  if (link.toKind === "highlight") {
    const highlight = highlights.find((item) => item.id === link.toId);
    return {
      title: link.label || highlight?.chapterTitle || t("notes.knowledgeSourceHighlight", "高亮"),
      detail: highlight?.text || link.toId,
      cfi: link.cfi || highlight?.cfi,
    };
  }

  if (link.toKind === "cfi") {
    return {
      title: link.label || t("notes.knowledgeSourcePosition", "书中位置"),
      detail: link.cfi || link.toId,
      cfi: link.cfi || link.toId,
    };
  }

  if (link.toKind === "book") {
    return {
      title: link.label || t("notes.knowledgeSourceBook", "书籍"),
      detail: link.toId,
    };
  }

  return {
    title: link.label || t("notes.knowledgeSourceReference", "引用"),
    detail: link.toId,
    cfi: link.cfi,
  };
}

function KnowledgeRelationsCard({
  links,
  backlinks,
  documents,
  highlights,
  isLoading,
  onSelectDocument,
  onOpenBook,
  t,
  styles,
}: {
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  documents: KnowledgeDocument[];
  highlights: HighlightWithBook[];
  isLoading: boolean;
  onSelectDocument: (document: KnowledgeDocument) => void;
  onOpenBook: (cfi?: string) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
}) {
  const sourceLinks = links.filter((link) => link.relation === "source").slice(0, 4);
  const relatedLinks = links.filter((link) => link.relation !== "source").slice(0, 4);
  const visibleBacklinks = backlinks.slice(0, 4);
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );

  return (
    <View style={styles.knowledgeSourcesCard}>
      <View style={styles.knowledgeSourcesHeader}>
        <Text style={styles.knowledgeSectionTitle}>{t("notes.knowledgeRelations", "关系")}</Text>
        {isLoading ? (
          <Text style={styles.knowledgeRelationLoading}>
            {t("notes.knowledgeRelationsLoading", "加载中")}
          </Text>
        ) : null}
      </View>

      <Text style={styles.knowledgeRelationGroupTitle}>
        {t("notes.knowledgeSourceLinks", "来源")}
      </Text>
      {sourceLinks.length === 0 ? (
        <Text style={styles.knowledgeEmptySources}>
          {t("notes.knowledgeNoSourceLinks", "暂无来源链接")}
        </Text>
      ) : (
        <View style={styles.knowledgeSourceList}>
          {sourceLinks.map((link) => {
            const target = knowledgeLinkTargetLabel(link, highlights, t);
            const canOpen = !!target.cfi || link.toKind === "book";
            return (
              <TouchableOpacity
                key={link.id}
                style={styles.knowledgeSourceItem}
                activeOpacity={canOpen ? 0.75 : 1}
                disabled={!canOpen}
                onPress={() => onOpenBook(target.cfi)}
              >
                <Text style={styles.knowledgeSourceChapter} numberOfLines={1}>
                  {target.title}
                </Text>
                <Text style={styles.knowledgeSourceText} numberOfLines={2}>
                  {target.detail}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.knowledgeRelationGroupTitle}>
        {t("notes.knowledgeRelatedLinks", "关联文档")}
      </Text>
      {relatedLinks.length === 0 ? (
        <Text style={styles.knowledgeEmptySources}>
          {t("notes.knowledgeNoRelatedLinks", "暂无关联文档")}
        </Text>
      ) : (
        <View style={styles.knowledgeSourceList}>
          {relatedLinks.map((link) => {
            const targetDocument =
              link.toKind === "document" ? documentById.get(link.toId) : undefined;
            const target = targetDocument
              ? {
                  title:
                    link.label ||
                    targetDocument.title ||
                    t("notes.knowledgeUntitledDocument", "未命名文档"),
                  detail: knowledgeDocumentTypeLabel(targetDocument, t),
                  cfi: undefined,
                }
              : knowledgeLinkTargetLabel(link, highlights, t);
            const canOpenDocument = !!targetDocument;
            const canOpenBook = !canOpenDocument && (!!target.cfi || link.toKind === "book");

            return (
              <TouchableOpacity
                key={link.id}
                style={styles.knowledgeSourceItem}
                activeOpacity={canOpenDocument || canOpenBook ? 0.75 : 1}
                disabled={!canOpenDocument && !canOpenBook}
                onPress={() => {
                  if (targetDocument) {
                    onSelectDocument(targetDocument);
                    return;
                  }
                  onOpenBook(target.cfi);
                }}
              >
                <Text style={styles.knowledgeSourceChapter} numberOfLines={1}>
                  {target.title}
                </Text>
                <Text style={styles.knowledgeSourceText} numberOfLines={2}>
                  {target.detail}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.knowledgeRelationGroupTitle}>
        {t("notes.knowledgeBacklinks", "反链")}
      </Text>
      {visibleBacklinks.length === 0 ? (
        <Text style={styles.knowledgeEmptySources}>
          {t("notes.knowledgeNoBacklinks", "暂无反链")}
        </Text>
      ) : (
        <View style={styles.knowledgeSourceList}>
          {visibleBacklinks.map(({ link, fromDocument }) => (
            <TouchableOpacity
              key={link.id}
              style={styles.knowledgeSourceItem}
              activeOpacity={0.75}
              onPress={() => onSelectDocument(fromDocument)}
            >
              <Text style={styles.knowledgeSourceChapter} numberOfLines={1}>
                {knowledgeDocumentTypeLabel(fromDocument, t)}
              </Text>
              <Text style={styles.knowledgeSourceText} numberOfLines={2}>
                {fromDocument.title || t("notes.knowledgeUntitledDocument", "未命名文档")}
              </Text>
              {!!fromDocument.excerpt && (
                <Text style={styles.knowledgeSourceChapter} numberOfLines={2}>
                  {fromDocument.excerpt}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function KnowledgeSummaryMemoryCard({
  document,
  isCompressing,
  onCompress,
  t,
  styles,
  colors,
}: {
  document: KnowledgeDocument;
  isCompressing: boolean;
  onCompress: () => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const summary = document.summaryMd?.trim();
  const updatedAt = document.summaryUpdatedAt;
  const isStale =
    !!summary &&
    document.summarySourceFingerprint !== createKnowledgeSummarySourceFingerprint(document);
  const statusLabel = !summary
    ? t("notes.knowledgeSummaryMissing", "暂无压缩记忆")
    : isStale
      ? t("notes.knowledgeSummaryStale", "需要刷新")
      : t("notes.knowledgeSummaryReady", "压缩记忆已就绪");
  const statusColor = !summary
    ? colors.mutedForeground
    : isStale
      ? colors.foreground
      : colors.primary;

  const markdownStyles = useMemo(
    () => ({
      body: styles.knowledgeSummaryMarkdownBody,
      heading1: styles.knowledgeSummaryMarkdownHeading,
      heading2: styles.knowledgeSummaryMarkdownHeading,
      heading3: styles.knowledgeSummaryMarkdownHeading,
      paragraph: styles.knowledgeSummaryMarkdownParagraph,
      bullet_list: styles.knowledgeSummaryMarkdownList,
      ordered_list: styles.knowledgeSummaryMarkdownList,
      list_item: styles.knowledgeSummaryMarkdownListItem,
      strong: styles.knowledgeSummaryMarkdownStrong,
      em: styles.knowledgeSummaryMarkdownEm,
      link: styles.knowledgeSummaryMarkdownLink,
      blockquote: styles.knowledgeSummaryMarkdownQuote,
      code_inline: styles.knowledgeSummaryMarkdownCode,
    }),
    [styles],
  );

  return (
    <View style={styles.knowledgeSummaryCard}>
      <View style={styles.knowledgeSummaryHeader}>
        <View style={styles.knowledgeSummaryTitleWrap}>
          <View style={styles.knowledgeSummaryIcon}>
            <BrainIcon size={15} color={colors.primary} />
          </View>
          <View style={styles.knowledgeSummaryTitleTextWrap}>
            <Text style={styles.knowledgeSectionTitle}>
              {t("notes.knowledgeSummaryMemory", "AI 记忆")}
            </Text>
            <Text style={[styles.knowledgeSummaryStatus, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.78}
          style={[
            styles.knowledgeSummaryButton,
            isCompressing && styles.knowledgeSummaryButtonDisabled,
          ]}
          onPress={onCompress}
          disabled={isCompressing}
          accessibilityRole="button"
          accessibilityLabel={
            isCompressing
              ? t("notes.knowledgeSummaryCompressing", "压缩中")
              : t("notes.knowledgeSummaryCompress", "压缩")
          }
        >
          {isCompressing ? (
            <LoaderIcon size={13} color={colors.primary} />
          ) : (
            <SparklesIcon size={13} color={colors.primary} />
          )}
          <Text style={styles.knowledgeSummaryButtonText}>
            {isCompressing
              ? t("notes.knowledgeSummaryCompressing", "压缩中")
              : t("notes.knowledgeSummaryCompress", "压缩")}
          </Text>
        </TouchableOpacity>
      </View>

      {summary ? (
        <View style={styles.knowledgeSummaryPreview}>
          <MarkdownRenderer content={summary} styleOverrides={markdownStyles} />
          {updatedAt ? (
            <Text style={styles.knowledgeSummaryUpdated}>
              {t("notes.knowledgeSummaryUpdatedAt", {
                time: new Date(updatedAt).toLocaleString(),
              })}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.knowledgeSummaryEmpty}>
          {t("notes.knowledgeSummaryPreview", "将当前文档压缩成紧凑记忆，方便后续 AI 检索。")}
        </Text>
      )}
    </View>
  );
}

function KnowledgeMarkdownImportReviewSheet({
  review,
  documents,
  isApplying,
  onApply,
  onDismiss,
  t,
  styles,
  colors,
}: {
  review: KnowledgeMarkdownImportReview | null;
  documents: KnowledgeDocument[];
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const visibleItems = review?.items.slice(0, 6) ?? [];
  const hiddenCount = Math.max(0, (review?.items.length ?? 0) - visibleItems.length);
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );
  const importDestinationLabel = useCallback(
    (proposal: KnowledgeImportWriteProposal): string | null => {
      if (proposal.action !== "create") return null;
      const parentId = proposal.draft.parentId;
      if (!parentId) return t("notes.knowledgeVaultRoot", "知识库");
      const parent = documentById.get(parentId);
      if (!parent) return parentId;
      return knowledgeDocumentPathItems(parent, documents, t)
        .map((item) => item.title)
        .join(" / ");
    },
    [documentById, documents, t],
  );

  return (
    <Modal visible={!!review} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.knowledgeMoveSheetBackdrop} onPress={onDismiss} />
      <View style={styles.knowledgeImportSheet}>
        <View style={styles.knowledgeContextSheetHandle} />
        <View style={styles.knowledgeImportSheetHeader}>
          <View style={styles.knowledgeImportSheetTitleWrap}>
            <View style={styles.knowledgeImportSheetIcon}>
              <ScrollTextIcon size={16} color={colors.primary} />
            </View>
            <View style={styles.knowledgeImportSheetTitleBlock}>
              <Text style={styles.knowledgeImportSheetTitle}>
                {t("notes.knowledgeMarkdownImportTitle", "导入 Markdown 为知识文档")}
              </Text>
              <Text style={styles.knowledgeImportSheetSubtitle}>
                {t("notes.knowledgeMarkdownImportDescription", {
                  count: review?.items.length ?? 0,
                })}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.76}
            style={styles.knowledgeMoveSheetClose}
            onPress={onDismiss}
            accessibilityLabel={t("common.close", "关闭")}
          >
            <XIcon size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.knowledgeImportSheetScroll}
          contentContainerStyle={styles.knowledgeImportSheetContent}
          showsVerticalScrollIndicator={false}
        >
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
            const destinationLabel = importDestinationLabel(proposal);

            return (
              <View key={item.path} style={styles.knowledgeImportItem}>
                <View style={styles.knowledgeImportItemHeader}>
                  <View style={styles.knowledgeImportItemTitleBlock}>
                    <Text style={styles.knowledgeImportItemTitle} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text style={styles.knowledgeImportItemPath} numberOfLines={1}>
                      {mobileFileName(item.path)}
                    </Text>
                    {!!destinationLabel && (
                      <View style={styles.knowledgeImportDestination}>
                        <FolderIcon size={12} color={colors.primary} />
                        <Text style={styles.knowledgeImportDestinationText} numberOfLines={1}>
                          {t("notes.knowledgeImportDestination", {
                            path: destinationLabel,
                          })}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.knowledgeImportItemBadge}>
                    {proposal.action === "create"
                      ? t("notes.knowledgeMarkdownImportWillCreate", "将创建")
                      : t("notes.knowledgeVaultImportWillUpdate", "将更新")}
                  </Text>
                </View>

                {preview ? (
                  <Text style={styles.knowledgeImportItemPreview} numberOfLines={2}>
                    {preview}
                  </Text>
                ) : null}

                {tags.length > 0 || item.warnings.length > 0 ? (
                  <View style={styles.knowledgeImportMetaRow}>
                    {tags.slice(0, 4).map((tag) => (
                      <Text key={tag} style={styles.knowledgeImportTag} numberOfLines={1}>
                        {tag}
                      </Text>
                    ))}
                    {tags.length > 4 ? (
                      <Text style={styles.knowledgeImportTag}>+{tags.length - 4}</Text>
                    ) : null}
                    {item.warnings.length > 0 ? (
                      <Text style={styles.knowledgeImportWarning}>
                        {t("notes.knowledgeMarkdownImportWarningCount", {
                          count: item.warnings.length,
                        })}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          {hiddenCount > 0 ? (
            <Text style={styles.knowledgeImportHiddenText}>
              {t("notes.knowledgeMarkdownImportMoreFiles", { count: hiddenCount })}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.knowledgeImportFooter}>
          <Text style={styles.knowledgeImportSafeHint}>
            {t(
              "notes.knowledgeMarkdownImportSafeHint",
              "导入会创建知识文档，不会修改原始 Markdown 文件。",
            )}
          </Text>
          <View style={styles.knowledgeImportFooterActions}>
            <TouchableOpacity
              activeOpacity={0.78}
              style={styles.knowledgeImportSecondaryButton}
              onPress={onDismiss}
              accessibilityRole="button"
            >
              <Text style={styles.knowledgeImportSecondaryButtonText}>
                {t("common.cancel", "取消")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.78}
              style={[
                styles.knowledgeImportPrimaryButton,
                isApplying && styles.knowledgeImportButtonDisabled,
              ]}
              onPress={onApply}
              disabled={isApplying || !review || review.items.length === 0}
              accessibilityRole="button"
            >
              {isApplying ? <LoaderIcon size={14} color={colors.primaryForeground} /> : null}
              <Text style={styles.knowledgeImportPrimaryButtonText}>
                {isApplying
                  ? t("notes.knowledgeMarkdownImportApplying", "导入中...")
                  : t("notes.knowledgeMarkdownImportApply", "导入文档")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function knowledgeDocumentTypeLabel(document: KnowledgeDocument, t: TFunction): string {
  if (document.type === "book_home") return t("notes.knowledgeDocumentHome", "主页");
  if (document.type === "folder") return t("notes.knowledgeDocumentFolder", "文件夹");
  if (document.type === "review") return t("notes.knowledgeDocumentReview", "书评");
  if (document.type === "summary") return t("notes.knowledgeDocumentSummary", "摘要");
  if (document.type === "highlight_note") return t("notes.knowledgeDocumentHighlight", "高亮笔记");
  return t("notes.knowledgeDocumentNote", "笔记");
}

function knowledgeDocumentPathItems(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  t: TFunction,
  activeTitle?: string,
): Array<{ id: string; title: string; type?: KnowledgeDocumentType }> {
  const byId = new Map(documents.map((item) => [item.id, item]));
  const path: KnowledgeDocument[] = [];
  const seen = new Set<string>();
  let current: KnowledgeDocument | undefined = document;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return [
    { id: "__vault__", title: t("notes.knowledgeVaultRoot", "知识库") },
    ...path.map(
      (item, index) =>
        ({
          id: item.id,
          type: item.type,
          title:
            index === path.length - 1 && activeTitle?.trim()
              ? activeTitle.trim()
              : item.title.trim() || t("notes.knowledgeUntitledDocument", "未命名文档"),
        }) satisfies { id: string; title: string; type?: KnowledgeDocumentType },
    ),
  ];
}

function knowledgeDocumentPathText(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  t: TFunction,
  activeTitle?: string,
): string {
  return knowledgeDocumentPathItems(document, documents, t, activeTitle)
    .map((item) => item.title)
    .join(" / ");
}

function knowledgeDocumentParentPathText(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  t: TFunction,
): string {
  const parts = knowledgeDocumentPathText(document, documents, t).split(" / ");
  return parts.slice(0, -1).join(" / ");
}

function KnowledgeDocumentExplorer({
  documents,
  activeDocument,
  activeDocumentId,
  isRootActive,
  isCreating,
  onSelectRoot,
  onSelect,
  onCreate,
  t,
  styles,
  colors,
}: {
  documents: KnowledgeDocument[];
  activeDocument: KnowledgeDocument | null;
  activeDocumentId: string | null;
  isRootActive: boolean;
  isCreating: boolean;
  onSelectRoot: () => void;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const [query, setQuery] = useState("");
  const homeDocumentId = useMemo(
    () => documents.find((document) => document.type === "book_home")?.id,
    [documents],
  );
  const tree = useMemo(
    () => buildKnowledgeDocumentTree(documents, homeDocumentId),
    [documents, homeDocumentId],
  );
  const orphanedDocumentIds = useMemo(
    () => new Set(tree.orphaned.map((document) => document.id)),
    [tree],
  );
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      if (!document.parentId) continue;
      counts.set(document.parentId, (counts.get(document.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [createParentId, setCreateParentId] = useState<string | undefined>();
  const [isCreateSheetVisible, setIsCreateSheetVisible] = useState(false);
  const activeCreateParentId =
    !isRootActive && activeDocument?.type === "folder"
      ? activeDocument.id
      : !isRootActive
        ? activeDocument?.parentId
        : undefined;
  const createDestinationDocument = activeCreateParentId
    ? documents.find((document) => document.id === activeCreateParentId)
    : null;
  const createDestinationPath = createDestinationDocument
    ? knowledgeDocumentPathText(createDestinationDocument, documents, t)
    : t("notes.knowledgeVaultRoot", "知识库");
  const normalizedQuery = query.trim().toLowerCase();
  const createParentDocument = useMemo(
    () => documents.find((document) => document.id === createParentId),
    [createParentId, documents],
  );
  const createDestinationLabel =
    createParentDocument?.title.trim() || t("notes.knowledgeVaultRoot", "知识库");
  const createOptions = useMemo(
    () =>
      [
        {
          type: "folder" as const,
          label: t("notes.knowledgeNewFolder", "新建文件夹"),
          icon: "folder",
        },
        {
          type: "standalone_note" as const,
          label: t("notes.knowledgeNewNote", "新建笔记"),
          icon: "note",
        },
        {
          type: "review" as const,
          label: t("notes.knowledgeNewReview", "新建书评"),
          icon: "review",
        },
        {
          type: "summary" as const,
          label: t("notes.knowledgeNewSummary", "新建摘要"),
          icon: "summary",
        },
      ] satisfies Array<{
        type: CreatableKnowledgeDocumentType;
        label: string;
        icon: "folder" | "note" | "review" | "summary";
      }>,
    [t],
  );

  useEffect(() => {
    if (!activeDocument) return;
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (activeDocument.type === "folder") next.add(activeDocument.id);
      let parentId = activeDocument.parentId;
      while (parentId) {
        next.add(parentId);
        parentId = documents.find((document) => document.id === parentId)?.parentId;
      }
      return next;
    });
  }, [activeDocument, documents]);

  const visibleSearchNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    return flattenKnowledgeDocumentTree(tree.roots).filter((node) => {
      const document = node.document;
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
  }, [query, t, tree.roots]);

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showCreatePicker = useCallback((parentId?: string) => {
    setCreateParentId(parentId);
    setIsCreateSheetVisible(true);
  }, []);
  const handleCreate = useCallback(
    (type: CreatableKnowledgeDocumentType) => {
      setIsCreateSheetVisible(false);
      onCreate(type, createParentId);
    },
    [createParentId, onCreate],
  );

  return (
    <View style={styles.knowledgeExplorerCard}>
      <View style={styles.knowledgeExplorerHeader}>
        <View style={styles.knowledgeExplorerTitleBlock}>
          <Text style={styles.knowledgeSectionTitle}>
            {t("notes.knowledgeWorkspaceVault", "目录")}
          </Text>
          <Text style={styles.knowledgeExplorerHint} numberOfLines={1}>
            {t("notes.knowledgeCreateIn", "创建于")} · {createDestinationPath}
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.78}
          style={[styles.knowledgeExplorerCreateButton, isCreating && { opacity: 0.55 }]}
          onPress={() => showCreatePicker(activeCreateParentId)}
          disabled={isCreating}
          accessibilityLabel={t("notes.knowledgeNewDocument", "新建文档")}
        >
          <PlusIcon size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.knowledgeDocumentSearch}>
        <SearchIcon size={13} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("notes.knowledgeDocumentSearchPlaceholder", "搜索文档")}
          placeholderTextColor={colors.mutedForeground}
          style={styles.knowledgeDocumentSearchInput}
          returnKeyType="search"
        />
      </View>

      <View style={styles.knowledgeTreeList}>
        {!normalizedQuery ? (
          <TouchableOpacity
            activeOpacity={0.78}
            style={[styles.knowledgeTreeNode, isRootActive && styles.knowledgeTreeNodeActive]}
            onPress={onSelectRoot}
            accessibilityRole="button"
            accessibilityLabel={t("notes.knowledgeVaultRoot", "知识库")}
          >
            <View style={styles.knowledgeTreeToggleSpacer} />
            <View
              style={[styles.knowledgeTreeIcon, isRootActive && styles.knowledgeTreeIconActive]}
            >
              <FolderIcon size={15} color={isRootActive ? colors.primary : colors.foreground} />
            </View>
            <View style={styles.knowledgeTreeTextBlock}>
              <Text
                numberOfLines={1}
                style={[styles.knowledgeTreeTitle, isRootActive && styles.knowledgeTreeTitleActive]}
              >
                {t("notes.knowledgeVaultRoot", "知识库")}
              </Text>
              <Text numberOfLines={1} style={styles.knowledgeTreeMeta}>
                {t("notes.knowledgeFolderInside", "目录内容")}
              </Text>
            </View>
            <Text
              style={[styles.knowledgeTreeCount, isRootActive && styles.knowledgeTreeCountActive]}
            >
              {documents.length}
            </Text>
          </TouchableOpacity>
        ) : null}
        {normalizedQuery ? (
          visibleSearchNodes.length === 0 ? (
            <View style={styles.knowledgeDocumentEmptyResult}>
              <Text style={styles.knowledgeDocumentEmptyResultText}>
                {t("notes.knowledgeNoDocumentResults", "没有匹配的文档")}
              </Text>
            </View>
          ) : (
            visibleSearchNodes.map((node) => (
              <KnowledgeDocumentTreeRow
                key={node.document.id}
                node={{ ...node, depth: 0 }}
                activeDocumentId={activeDocumentId}
                expandedFolderIds={expandedFolderIds}
                childCountByParentId={childCountByParentId}
                orphanedDocumentIds={orphanedDocumentIds}
                onToggleFolder={toggleFolder}
                onSelect={onSelect}
                t={t}
                styles={styles}
                colors={colors}
                forceLeaf
                pathLabel={knowledgeDocumentParentPathText(node.document, documents, t)}
              />
            ))
          )
        ) : tree.roots.length === 0 ? (
          <View style={styles.knowledgeDocumentEmptyResult}>
            <Text style={styles.knowledgeDocumentEmptyResultText}>
              {t("notes.knowledgeNoDocumentResults", "没有匹配的文档")}
            </Text>
          </View>
        ) : (
          tree.roots.map((node) => (
            <KnowledgeDocumentTreeRow
              key={node.document.id}
              node={node}
              activeDocumentId={activeDocumentId}
              expandedFolderIds={expandedFolderIds}
              childCountByParentId={childCountByParentId}
              orphanedDocumentIds={orphanedDocumentIds}
              onToggleFolder={toggleFolder}
              onSelect={onSelect}
              t={t}
              styles={styles}
              colors={colors}
            />
          ))
        )}
      </View>

      <Modal
        visible={isCreateSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCreateSheetVisible(false)}
      >
        <Pressable
          style={styles.knowledgeMoveSheetBackdrop}
          onPress={() => setIsCreateSheetVisible(false)}
        />
        <View style={styles.knowledgeMoveSheet}>
          <View style={styles.knowledgeMoveSheetHeader}>
            <View style={styles.knowledgeMoveSheetTitleBlock}>
              <Text style={styles.knowledgeMoveSheetTitle}>
                {t("notes.knowledgeNewDocument", "新建文档")}
              </Text>
              <Text style={styles.knowledgeMoveSheetSubtitle} numberOfLines={1}>
                {t("notes.knowledgeCreateIn", "创建于")} · {createDestinationLabel}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.76}
              style={styles.knowledgeMoveSheetClose}
              onPress={() => setIsCreateSheetVisible(false)}
              accessibilityLabel={t("common.cancel", "取消")}
            >
              <XIcon size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={[styles.knowledgeMoveTargetList, styles.knowledgeCreateTargetList]}>
            {createOptions.map((option) => (
              <TouchableOpacity
                key={option.type}
                activeOpacity={0.78}
                style={styles.knowledgeMoveTarget}
                onPress={() => handleCreate(option.type)}
                disabled={isCreating}
                accessibilityLabel={option.label}
              >
                <View style={styles.knowledgeMoveTargetIcon}>
                  {option.icon === "folder" ? (
                    <FolderPlusIcon size={15} color={colors.primary} />
                  ) : option.icon === "review" ? (
                    <NotebookPenIcon size={15} color={colors.primary} />
                  ) : option.icon === "summary" ? (
                    <SparklesIcon size={15} color={colors.primary} />
                  ) : (
                    <ScrollTextIcon size={15} color={colors.primary} />
                  )}
                </View>
                <Text style={styles.knowledgeMoveTargetText} numberOfLines={1}>
                  {option.label}
                </Text>
                <ChevronRightIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function KnowledgeDocumentTreeRow({
  node,
  activeDocumentId,
  expandedFolderIds,
  childCountByParentId,
  orphanedDocumentIds,
  onToggleFolder,
  onSelect,
  t,
  styles,
  colors,
  forceLeaf,
  pathLabel,
}: {
  node: KnowledgeDocumentTreeNode;
  activeDocumentId: string | null;
  expandedFolderIds: Set<string>;
  childCountByParentId: Map<string, number>;
  orphanedDocumentIds: Set<string>;
  onToggleFolder: (id: string) => void;
  onSelect: (document: KnowledgeDocument) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
  forceLeaf?: boolean;
  pathLabel?: string;
}) {
  const document = node.document;
  const isFolder = document.type === "folder";
  const isExpanded = expandedFolderIds.has(document.id);
  const isActive = document.id === activeDocumentId;
  const isOrphaned = orphanedDocumentIds.has(document.id);
  const childCount = childCountByParentId.get(document.id) ?? 0;
  const title = document.title.trim() || t("notes.knowledgeUntitledDocument", "未命名文档");
  const showChildren = isFolder && isExpanded && node.children.length > 0 && !forceLeaf;

  return (
    <View>
      <TouchableOpacity
        activeOpacity={0.78}
        style={[
          styles.knowledgeTreeNode,
          isActive && styles.knowledgeTreeNodeActive,
          { paddingLeft: 10 + Math.min(node.depth, 6) * 16 },
        ]}
        onPress={() => onSelect(document)}
      >
        {node.depth > 0 && !forceLeaf ? (
          <View
            pointerEvents="none"
            style={[styles.knowledgeTreeConnector, { left: 17 + Math.min(node.depth - 1, 5) * 16 }]}
          />
        ) : null}
        {isFolder && !forceLeaf ? (
          <TouchableOpacity
            activeOpacity={0.72}
            style={styles.knowledgeTreeToggle}
            onPress={() => onToggleFolder(document.id)}
            accessibilityLabel={
              isExpanded
                ? t("notes.knowledgeCollapseFolder", "收起文件夹")
                : t("notes.knowledgeExpandFolder", "展开文件夹")
            }
          >
            <View style={isExpanded ? styles.knowledgeTreeToggleExpanded : undefined}>
              <ChevronRightIcon
                size={14}
                color={isActive ? colors.primary : colors.mutedForeground}
              />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.knowledgeTreeToggleSpacer} />
        )}
        <View style={[styles.knowledgeTreeIcon, isActive && styles.knowledgeTreeIconActive]}>
          {isFolder ? (
            <FolderIcon size={15} color={isActive ? colors.primary : colors.foreground} />
          ) : (
            <ScrollTextIcon size={15} color={isActive ? colors.primary : colors.mutedForeground} />
          )}
        </View>
        <View style={styles.knowledgeTreeTextBlock}>
          <Text
            numberOfLines={1}
            style={[styles.knowledgeTreeTitle, isActive && styles.knowledgeTreeTitleActive]}
          >
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.knowledgeTreeMeta}>
            {pathLabel ||
              (isOrphaned
                ? `${knowledgeDocumentTypeLabel(document, t)} · ${t(
                    "notes.knowledgeOrphanedDocument",
                    "孤立",
                  )}`
                : knowledgeDocumentTypeLabel(document, t))}
          </Text>
        </View>
        {isFolder ? (
          <Text style={[styles.knowledgeTreeCount, isActive && styles.knowledgeTreeCountActive]}>
            {childCount}
          </Text>
        ) : null}
      </TouchableOpacity>

      {showChildren
        ? node.children.map((child) => (
            <KnowledgeDocumentTreeRow
              key={child.document.id}
              node={child}
              activeDocumentId={activeDocumentId}
              expandedFolderIds={expandedFolderIds}
              childCountByParentId={childCountByParentId}
              orphanedDocumentIds={orphanedDocumentIds}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              t={t}
              styles={styles}
              colors={colors}
            />
          ))
        : null}
    </View>
  );
}

function KnowledgeFolderBrowserItem({
  item,
  childCountByParentId,
  onSelect,
  onOpenActions,
  t,
  styles,
  colors,
}: {
  item: KnowledgeDocument;
  childCountByParentId: Map<string, number>;
  onSelect: (document: KnowledgeDocument) => void;
  onOpenActions: (document: KnowledgeDocument) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const isFolder = item.type === "folder";
  const isHome = item.type === "book_home";
  const childCount = childCountByParentId.get(item.id) ?? 0;
  const meta = isFolder
    ? t("notes.knowledgeFolderChildCount", { count: childCount })
    : item.excerpt;

  return (
    <View style={styles.knowledgeFolderItem}>
      <TouchableOpacity
        activeOpacity={0.78}
        style={styles.knowledgeFolderItemMain}
        onPress={() => onSelect(item)}
      >
        <View style={[styles.knowledgeFolderItemIcon, isFolder && styles.knowledgeFolderIcon]}>
          {isFolder ? (
            <FolderIcon size={15} color={colors.primary} />
          ) : isHome ? (
            <BookOpenIcon size={15} color={colors.mutedForeground} />
          ) : (
            <ScrollTextIcon size={15} color={colors.mutedForeground} />
          )}
        </View>
        <View style={styles.knowledgeFolderItemText}>
          <Text style={styles.knowledgeFolderItemTitle} numberOfLines={1}>
            {item.title || t("notes.knowledgeUntitledDocument", "未命名文档")}
          </Text>
          <Text style={styles.knowledgeFolderItemMeta} numberOfLines={1}>
            {knowledgeDocumentTypeLabel(item, t)}
            {!!meta && ` · ${meta}`}
          </Text>
        </View>
        {isFolder ? <Text style={styles.knowledgeFolderItemCount}>{childCount}</Text> : null}
        <ChevronRightIcon size={14} color={colors.mutedForeground} />
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.72}
        style={styles.knowledgeFolderItemMore}
        onPress={() => onOpenActions(item)}
        accessibilityLabel={t("notes.knowledgeDocumentActions", "文档操作")}
      >
        <MoreVerticalIcon size={15} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

function KnowledgeVaultRootOverview({
  items,
  documents,
  isCreating,
  onSelect,
  onCreate,
  onOpenActions,
  t,
  styles,
  colors,
}: {
  items: KnowledgeDocument[];
  documents: KnowledgeDocument[];
  isCreating: boolean;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onOpenActions: (document: KnowledgeDocument) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      if (!document.parentId) continue;
      counts.set(document.parentId, (counts.get(document.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const folderChildren = items.filter((item) => item.type === "folder");
  const noteChildren = items.filter((item) => item.type !== "folder");

  return (
    <View style={styles.knowledgeFolderOverview}>
      <View style={styles.knowledgeFolderHeader}>
        <View style={styles.knowledgeFolderLeadText}>
          <Text style={styles.knowledgeFolderTitle} numberOfLines={1}>
            {t("notes.knowledgeVaultRoot", "知识库")}
          </Text>
          <Text style={styles.knowledgeFolderDescription} numberOfLines={1}>
            {t("notes.knowledgeFolderInside", "目录内容")}
          </Text>
          <Text style={styles.knowledgeFolderMeta} numberOfLines={1}>
            {items.length} {t("notes.knowledgeDocuments", "文档")}
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.78}
          style={[styles.knowledgeFolderIconAction, isCreating && { opacity: 0.55 }]}
          onPress={() => onCreate("folder")}
          disabled={isCreating}
          accessibilityLabel={t("notes.knowledgeNewFolder", "新建文件夹")}
        >
          <FolderPlusIcon size={15} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.78}
          style={[styles.knowledgeFolderIconAction, isCreating && { opacity: 0.55 }]}
          onPress={() => onCreate("standalone_note")}
          disabled={isCreating}
          accessibilityLabel={t("notes.knowledgeNewNote", "新建笔记")}
        >
          <PlusIcon size={15} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={styles.knowledgeFolderEmpty}>
          <Text style={styles.knowledgeFolderEmptyTitle}>
            {t("notes.knowledgeFolderEmpty", "这个文件夹还是空的")}
          </Text>
          <Text style={styles.knowledgeFolderEmptyHint}>
            {t("notes.knowledgeFolderEmptyHint", "在这里新建笔记或文件夹，慢慢搭出自己的目录。")}
          </Text>
          <View style={styles.knowledgeFolderActionRow}>
            <TouchableOpacity
              activeOpacity={0.78}
              style={[styles.knowledgeFolderAction, isCreating && { opacity: 0.55 }]}
              onPress={() => onCreate("folder")}
              disabled={isCreating}
              accessibilityLabel={t("notes.knowledgeNewFolder", "新建文件夹")}
            >
              <FolderPlusIcon size={14} color={colors.primary} />
              <Text style={styles.knowledgeFolderActionText} numberOfLines={1}>
                {t("notes.knowledgeNewFolder", "新建文件夹")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.78}
              style={[styles.knowledgeFolderAction, isCreating && { opacity: 0.55 }]}
              onPress={() => onCreate("standalone_note")}
              disabled={isCreating}
              accessibilityLabel={t("notes.knowledgeNewNote", "新建笔记")}
            >
              <PlusIcon size={14} color={colors.primary} />
              <Text style={styles.knowledgeFolderActionText} numberOfLines={1}>
                {t("notes.knowledgeNewNote", "新建笔记")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.knowledgeFolderGroupStack}>
          {folderChildren.length > 0 ? (
            <View style={styles.knowledgeFolderGroup}>
              <View style={styles.knowledgeFolderGroupHeader}>
                <Text style={styles.knowledgeFolderGroupTitle}>
                  {t("notes.knowledgeFolderChildFolders", "文件夹")}
                </Text>
                <Text style={styles.knowledgeFolderGroupCount}>{folderChildren.length}</Text>
              </View>
              <View style={styles.knowledgeFolderItemList}>
                {folderChildren.map((item) => (
                  <KnowledgeFolderBrowserItem
                    key={item.id}
                    item={item}
                    childCountByParentId={childCountByParentId}
                    onSelect={onSelect}
                    onOpenActions={onOpenActions}
                    t={t}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {noteChildren.length > 0 ? (
            <View style={styles.knowledgeFolderGroup}>
              <View style={styles.knowledgeFolderGroupHeader}>
                <Text style={styles.knowledgeFolderGroupTitle}>
                  {t("notes.knowledgeFolderChildDocuments", "文档")}
                </Text>
                <Text style={styles.knowledgeFolderGroupCount}>{noteChildren.length}</Text>
              </View>
              <View style={styles.knowledgeFolderItemList}>
                {noteChildren.map((item) => (
                  <KnowledgeFolderBrowserItem
                    key={item.id}
                    item={item}
                    childCountByParentId={childCountByParentId}
                    onSelect={onSelect}
                    onOpenActions={onOpenActions}
                    t={t}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function KnowledgeFolderOverview({
  folder,
  items,
  documents,
  isCreating,
  onSelect,
  onCreate,
  onOpenActions,
  t,
  styles,
  colors,
}: {
  folder: KnowledgeDocument;
  items: KnowledgeDocument[];
  documents: KnowledgeDocument[];
  isCreating: boolean;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onOpenActions: (document: KnowledgeDocument) => void;
  t: TFunction;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const folderPath = knowledgeDocumentPathText(folder, documents, t);
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      if (!document.parentId) continue;
      counts.set(document.parentId, (counts.get(document.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const folderChildren = items.filter((item) => item.type === "folder");
  const noteChildren = items.filter((item) => item.type !== "folder");

  return (
    <View style={styles.knowledgeFolderOverview}>
      <View style={styles.knowledgeFolderHeader}>
        <View style={styles.knowledgeFolderLeadText}>
          <Text style={styles.knowledgeFolderTitle} numberOfLines={1}>
            {folder.title || t("notes.knowledgeUntitledDocument", "未命名文档")}
          </Text>
          <Text style={styles.knowledgeFolderDescription} numberOfLines={1}>
            {folderPath}
          </Text>
          <Text style={styles.knowledgeFolderMeta} numberOfLines={1}>
            {items.length} {t("notes.knowledgeDocuments", "文档")}
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.78}
          style={[styles.knowledgeFolderIconAction, isCreating && { opacity: 0.55 }]}
          onPress={() => onCreate("folder", folder.id)}
          disabled={isCreating}
          accessibilityLabel={t("notes.knowledgeNewFolder", "新建文件夹")}
        >
          <FolderPlusIcon size={15} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.78}
          style={[styles.knowledgeFolderIconAction, isCreating && { opacity: 0.55 }]}
          onPress={() => onCreate("standalone_note", folder.id)}
          disabled={isCreating}
          accessibilityLabel={t("notes.knowledgeNewNote", "新建笔记")}
        >
          <PlusIcon size={15} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={styles.knowledgeFolderEmpty}>
          <Text style={styles.knowledgeFolderEmptyTitle}>
            {t("notes.knowledgeFolderEmpty", "这个文件夹还是空的")}
          </Text>
          <Text style={styles.knowledgeFolderEmptyHint}>
            {t("notes.knowledgeFolderEmptyHint", "在这里新建笔记或文件夹，慢慢搭出自己的目录。")}
          </Text>
          <View style={styles.knowledgeFolderActionRow}>
            <TouchableOpacity
              activeOpacity={0.78}
              style={[styles.knowledgeFolderAction, isCreating && { opacity: 0.55 }]}
              onPress={() => onCreate("folder", folder.id)}
              disabled={isCreating}
              accessibilityLabel={t("notes.knowledgeNewFolder", "新建文件夹")}
            >
              <FolderPlusIcon size={14} color={colors.primary} />
              <Text style={styles.knowledgeFolderActionText} numberOfLines={1}>
                {t("notes.knowledgeNewFolder", "新建文件夹")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.78}
              style={[styles.knowledgeFolderAction, isCreating && { opacity: 0.55 }]}
              onPress={() => onCreate("standalone_note", folder.id)}
              disabled={isCreating}
              accessibilityLabel={t("notes.knowledgeNewNote", "新建笔记")}
            >
              <PlusIcon size={14} color={colors.primary} />
              <Text style={styles.knowledgeFolderActionText} numberOfLines={1}>
                {t("notes.knowledgeNewNote", "新建笔记")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.knowledgeFolderGroupStack}>
          {folderChildren.length > 0 ? (
            <View style={styles.knowledgeFolderGroup}>
              <View style={styles.knowledgeFolderGroupHeader}>
                <Text style={styles.knowledgeFolderGroupTitle}>
                  {t("notes.knowledgeFolderChildFolders", "文件夹")}
                </Text>
                <Text style={styles.knowledgeFolderGroupCount}>{folderChildren.length}</Text>
              </View>
              <View style={styles.knowledgeFolderItemList}>
                {folderChildren.map((item) => (
                  <KnowledgeFolderBrowserItem
                    key={item.id}
                    item={item}
                    childCountByParentId={childCountByParentId}
                    onSelect={onSelect}
                    onOpenActions={onOpenActions}
                    t={t}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {noteChildren.length > 0 ? (
            <View style={styles.knowledgeFolderGroup}>
              <View style={styles.knowledgeFolderGroupHeader}>
                <Text style={styles.knowledgeFolderGroupTitle}>
                  {t("notes.knowledgeFolderChildDocuments", "文档")}
                </Text>
                <Text style={styles.knowledgeFolderGroupCount}>{noteChildren.length}</Text>
              </View>
              <View style={styles.knowledgeFolderItemList}>
                {noteChildren.map((item) => (
                  <KnowledgeFolderBrowserItem
                    key={item.id}
                    item={item}
                    childCountByParentId={childCountByParentId}
                    onSelect={onSelect}
                    onOpenActions={onOpenActions}
                    t={t}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** Note detail card — matching Tauri NoteDetailCard */
