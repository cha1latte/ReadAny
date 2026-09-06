(function installReadAnyJustifiedText(root) {
  const MARKER = "data-readany-justify-body";
  const originals = new WeakMap();
  const EXCLUDED_TAGS = new Set(
    "pre code kbd samp table caption figcaption form button input textarea select svg math h1 h2 h3 h4 h5 h6 nav ul ol dl blockquote".split(
      " ",
    ),
  );

  function apply(doc, enabled, unsupportedLayout, policy) {
    if (policy?.decision === "preserve") return;
    if (!doc || !doc.body || !doc.defaultView) return;

    for (const element of doc.querySelectorAll(`[${MARKER}]`)) {
      const original = originals.get(element);
      if (original) {
        if (original.value) {
          element.style.setProperty("text-align", original.value, original.priority);
        } else {
          element.style.removeProperty("text-align");
        }
        if (!original.hadStyle && !element.style.length) element.removeAttribute("style");
        originals.delete(element);
      }
      element.removeAttribute(MARKER);
    }
    if (!enabled || unsupportedLayout) return;

    // Snapshot all publisher alignments before changing any inherited styles.
    // Centered blocks need an explicit override too, so a justified parent
    // cannot change their originally inherited centering.
    const elements = [];
    const inspecting = policy?.decision === "pending";
    const styles = new Map();
    const excludedElements = new Set();
    const computedStyle = (element) => {
      if (!styles.has(element)) styles.set(element, doc.defaultView.getComputedStyle(element));
      return styles.get(element);
    };
    for (const element of [doc.body, ...doc.body.querySelectorAll("*")]) {
      // DOM order lets descendants reuse their parent's exclusion decision.
      const excludedRoot = EXCLUDED_TAGS.has(element.localName);
      const excluded = excludedRoot || excludedElements.has(element.parentElement);
      if (excluded) {
        excludedElements.add(element);
        if (!excludedRoot) continue;
      }
      const computed = computedStyle(element);
      if (
        !["block", "list-item", "flow-root", "table", "table-caption", "inline-block"].includes(
          computed.display,
        )
      )
        continue;
      const alignment = computed.textAlign.toLowerCase() || "start";
      // Only text belonging to this block makes it prose. Structural wrappers
      // retain their alignment; their child paragraphs are considered separately.
      let prose = false;
      if (!excluded) {
        for (let node = element.firstChild; node; node = node.nextSibling) {
          if (
            (node.nodeType === 3 && node.textContent.trim()) ||
            (node.nodeType === 1 &&
              computedStyle(node).display === "inline" &&
              !EXCLUDED_TAGS.has(node.localName) &&
              node.textContent.trim())
          ) {
            prose = true;
            break;
          }
        }
      }
      if (inspecting && alignment === "justify" && prose) {
        policy.decision = "preserve";
        return;
      }
      elements.push({ element, alignment, prose });
    }
    if (inspecting) policy.decision = "apply";
    for (const { element, alignment, prose } of elements) {
      // Publisher justification already has the desired effect, including when inherited.
      if (alignment === "justify") continue;
      const centered = ["center", "-webkit-center"].includes(alignment);
      // In an eligible book, right/end prose is intentionally justified too.
      // Only centering is exempt; the book policy preserves all alignments
      // when publisher justification was found in the opening chapter.
      const target = prose && !centered ? "justify" : alignment;
      // Preserve non-prose/centered blocks without writes unless a modified
      // ancestor could change their inherited alignment.
      if (target === alignment && !element.parentElement?.closest(`[${MARKER}]`)) continue;
      originals.set(element, {
        value: element.style.getPropertyValue("text-align"),
        priority: element.style.getPropertyPriority("text-align"),
        hadStyle: element.hasAttribute("style"),
      });
      element.setAttribute(MARKER, "true");
      element.style.setProperty("text-align", target, "important");
    }
  }

  function createBookPolicy() {
    return { decision: "pending" };
  }

  root.ReadAnyJustifiedText = { apply, createBookPolicy };
})(globalThis);
