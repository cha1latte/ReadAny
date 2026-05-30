import { MermaidView } from "@/components/common/MermaidView";
import { fontSize as fs, radius, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import type { CitationPart } from "@readany/core/types/message";
import * as Clipboard from "expo-clipboard";
import { Fragment, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Markdown, { type RenderRules, type ASTNode } from "react-native-markdown-display";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  styleOverrides?: Record<string, any>;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}

function CodeBlockWithCopy({
  code,
  style,
  colors,
}: { code: string; style: any; colors: ThemeColors }) {
  const { t } = useTranslation();
  return (
    <View style={style}>
      <TouchableOpacity
        onPress={() => Clipboard.setStringAsync(code)}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          padding: 4,
          backgroundColor: colors.card,
          borderRadius: 4,
          zIndex: 10,
        }}
      >
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
          {t("common.copy", "复制")}
        </Text>
      </TouchableOpacity>
      <Text style={style}>{code}</Text>
    </View>
  );
}

function getCodeLanguage(node: ASTNode): string {
  if ((node as any).sourceInfo) {
    return String((node as any).sourceInfo)
      .toLowerCase()
      .trim();
  }

  if (node.attributes?.lang) {
    return String(node.attributes.lang).toLowerCase().trim();
  }

  if (node.attributes?.className) {
    const className = node.attributes.className;
    if (Array.isArray(className)) {
      const langClass = className.find((c: string) => c.startsWith("language-"));
      if (langClass) {
        return langClass.replace("language-", "").toLowerCase().trim();
      }
    } else if (typeof className === "string") {
      return className.replace("language-", "").toLowerCase().trim();
    }
  }

  return "";
}

function CitationLink({
  num,
  citation,
  onCitationClick,
  colors,
}: {
  num: number;
  citation: CitationPart;
  onCitationClick?: (citation: CitationPart) => void;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={() => onCitationClick?.(citation)}
      activeOpacity={0.7}
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        marginHorizontal: 1,
      }}
    >
      <Text
        style={{
          color: colors.primary,
          fontSize: fs.xs,
          fontWeight: "600",
          lineHeight: fs.sm * 1.4,
        }}
      >
        [{num}]
      </Text>
      <Text
        style={{
          color: colors.primary,
          fontSize: 8,
          marginLeft: 1,
          lineHeight: fs.sm * 1.4,
        }}
      >
        ↗
      </Text>
    </TouchableOpacity>
  );
}

function renderTextWithCitations(
  text: string,
  citations: CitationPart[] | undefined,
  onCitationClick: ((citation: CitationPart) => void) | undefined,
  colors: ThemeColors,
): React.ReactNode[] {
  if (!citations || citations.length === 0) {
    return [<Fragment key="0">{text}</Fragment>];
  }

  const parts = text.split(/(\[\d+\])/g);
  const result: React.ReactNode[] = [];
  let offset = 0;

  for (const part of parts) {
    const keyOffset = offset;
    offset += part.length;
    const match = part.match(/\[(\d+)\]/);
    if (match) {
      const num = Number.parseInt(match[1]);
      const citation = citations.find((c) => c.citationIndex === num) ?? citations[num - 1];
      if (citation) {
        result.push(
          <CitationLink
            key={`citation-${keyOffset}-${num}`}
            num={num}
            citation={citation}
            onCitationClick={onCitationClick}
            colors={colors}
          />,
        );
        continue;
      }
    }
    if (part) {
      result.push(<Fragment key={`text-${keyOffset}-${part.length}`}>{part}</Fragment>);
    }
  }

  return result;
}

export function MarkdownRenderer({
  content,
  styleOverrides,
  citations,
  onCitationClick,
}: MarkdownRendererProps) {
  const colors = useColors();
  const baseStyles = makeMarkdownStyles(colors);
  // When styleOverrides is provided, use it directly without merging with baseStyles
  // This ensures custom styles (like tooltip dark background) are not overridden
  const styles = styleOverrides || baseStyles;

  const rules = useMemo<RenderRules>(
    () => ({
      fence: (node: ASTNode, _children: ReactNode[], _parentNodes: ASTNode[], style: any) => {
        const code = node.content || "";
        const lang = getCodeLanguage(node);

        if (lang === "mermaid") {
          return <MermaidView key={node.key} chart={code} />;
        }

        return <CodeBlockWithCopy key={node.key} code={code} style={style.fence} colors={colors} />;
      },
      code_block: (node: ASTNode, _children: ReactNode[], _parentNodes: ASTNode[], style: any) => {
        const code = node.content || "";
        const lang = getCodeLanguage(node);

        if (lang === "mermaid") {
          return <MermaidView key={node.key} chart={code} />;
        }

        return (
          <CodeBlockWithCopy key={node.key} code={code} style={style.code_block} colors={colors} />
        );
      },
      text: (
        node: ASTNode,
        _children: ReactNode[],
        _parentNodes: ASTNode[],
        style: any,
        inheritedStyles: any = {},
      ) => {
        const text = node.content || "";
        const textStyle = [inheritedStyles, style.text];
        const resolvedTextStyle = StyleSheet.flatten(textStyle);
        const themedTextStyle = resolvedTextStyle?.color
          ? textStyle
          : [...textStyle, { color: colors.foreground }];

        if (citations && citations.length > 0 && /\[\d+\]/.test(text)) {
          return (
            <Text key={node.key} style={themedTextStyle}>
              {renderTextWithCitations(text, citations, onCitationClick, colors)}
            </Text>
          );
        }
        return (
          <Text key={node.key} style={themedTextStyle}>
            {text}
          </Text>
        );
      },
    }),
    [colors, citations, onCitationClick],
  );

  return (
    <View>
      <Markdown style={styles} rules={rules} mergeStyle>
        {content}
      </Markdown>
    </View>
  );
}

const makeMarkdownStyles = (colors: ThemeColors) =>
  ({
    body: {
      color: colors.foreground,
      fontSize: fs.sm,
      lineHeight: 20,
    },
    text: {
      color: colors.foreground,
      fontSize: fs.sm,
      lineHeight: 20,
    },
    textgroup: {
      color: colors.foreground,
    },
    heading1: {
      color: colors.foreground,
      fontSize: fs.lg,
      fontWeight: "700",
      marginBottom: 8,
      marginTop: 12,
    },
    heading2: {
      color: colors.foreground,
      fontSize: fs.md,
      fontWeight: "600",
      marginBottom: 6,
      marginTop: 10,
    },
    heading3: {
      color: colors.foreground,
      fontSize: fs.base,
      fontWeight: "600",
      marginBottom: 4,
      marginTop: 8,
    },
    paragraph: {
      color: colors.foreground,
      fontSize: fs.sm,
      lineHeight: 20,
      marginBottom: 8,
      marginTop: 0,
    },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    link: { color: colors.blue, textDecorationLine: "none" },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      marginLeft: 0,
      marginVertical: 6,
      backgroundColor: "transparent",
    },
    code_inline: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    code_block: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      padding: 12,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    fence: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.xs + 1,
      fontFamily: "Menlo",
      padding: 12,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginVertical: 6,
    },
    thead: {
      backgroundColor: colors.muted,
    },
    th: {
      color: colors.foreground,
      fontSize: fs.xs,
      fontWeight: "600",
      padding: 6,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    td: {
      color: colors.foreground,
      fontSize: fs.xs,
      padding: 6,
      borderBottomWidth: 0.5,
      borderColor: colors.border,
    },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: {
      marginBottom: 4,
      flexDirection: "row",
    },
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: 12,
    },
    image: {
      maxWidth: 300,
      borderRadius: radius.md,
    },
  }) as const;
