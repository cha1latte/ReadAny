(function installReadAnyJustifiedText(root) {
  const MARKER = "data-readany-justify-body";
  const originals = new WeakMap();
  const EXCLUDED_ANCESTORS =
    "pre, code, kbd, samp, table, caption, figcaption, form, button, input, textarea, select, svg, math";

  function shouldJustify(element, unsupportedLayout, view) {
    if (!element || unsupportedLayout || element.closest(EXCLUDED_ANCESTORS)) return false;
    const computed = view.getComputedStyle(element);
    return ["block", "list-item", "flow-root"].includes(computed.display);
  }

  function apply(doc, enabled, unsupportedLayout) {
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
    const elements = [doc.body, ...doc.body.querySelectorAll("*")]
      .filter(
        (element) =>
          shouldJustify(element, unsupportedLayout, doc.defaultView) ||
          element.matches(EXCLUDED_ANCESTORS),
      )
      .map((element) => ({
        element,
        alignment: doc.defaultView.getComputedStyle(element).textAlign.toLowerCase() || "start",
        excluded: Boolean(element.closest(EXCLUDED_ANCESTORS)),
      }));
    for (const { element, alignment, excluded } of elements) {
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

  root.ReadAnyJustifiedText = { apply, shouldJustify };
})(globalThis);
