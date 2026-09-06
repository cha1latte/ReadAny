(function installReadAnyJustifiedText(root) {
  const MARKER = "data-readany-justify-body";
  const originals = new WeakMap();
  const EXCLUDED_ANCESTORS =
    "pre, code, kbd, samp, table, caption, figcaption, form, button, input, textarea, select, svg, math";

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
    const computedStyle = (element) => {
      if (!styles.has(element)) styles.set(element, doc.defaultView.getComputedStyle(element));
      return styles.get(element);
    };
    for (const element of [doc.body, ...doc.body.querySelectorAll("*")]) {
      const excluded = Boolean(element.closest(EXCLUDED_ANCESTORS));
      if (excluded && !element.matches(EXCLUDED_ANCESTORS)) continue;
      const computed = computedStyle(element);
      if (!excluded && !["block", "list-item", "flow-root"].includes(computed.display)) continue;
      const alignment = computed.textAlign.toLowerCase() || "start";
      if (
        inspecting &&
        alignment === "justify" &&
        !excluded &&
        !element.closest("h1, h2, h3, h4, h5, h6, nav")
      ) {
        // Check text in this block, not a wrapper whose child paragraphs
        // may override its alignment. Reuse the same computed-style reads.
        const hasText = Array.from(element.childNodes).some((node) => {
          if (node.nodeType === 3) return Boolean(node.textContent.trim());
          return (
            node.nodeType === 1 &&
            !node.closest(EXCLUDED_ANCESTORS) &&
            computedStyle(node).display === "inline" &&
            Boolean(node.textContent.trim())
          );
        });
        if (hasText) {
          policy.decision = "preserve";
          return;
        }
      }
      elements.push({ element, alignment, excluded });
    }
    if (inspecting) policy.decision = "apply";
    for (const { element, alignment, excluded } of elements) {
      // Publisher justification already has the desired effect, including when inherited.
      if (alignment === "justify") continue;
      originals.set(element, {
        value: element.style.getPropertyValue("text-align"),
        priority: element.style.getPropertyPriority("text-align"),
        hadStyle: element.hasAttribute("style"),
      });
      element.setAttribute(MARKER, "true");
      const centered = ["center", "-webkit-center"].includes(alignment);
      element.style.setProperty(
        "text-align",
        excluded ? alignment : centered ? "center" : "justify",
        "important",
      );
    }
  }

  function createBookPolicy() {
    return { decision: "pending" };
  }

  root.ReadAnyJustifiedText = { apply, createBookPolicy };
})(globalThis);
