/**
 * useFoliateEvents — bind/unbind foliate-view event listeners.
 *
 * Cleanly manages event subscriptions on the <foliate-view> Web Component.
 */
import { useEffect } from "react";
import type { FoliateView } from "./useFoliateView";

export interface FoliateEventHandlers {
  onLoad?: (event: Event) => void;
  onRelocate?: (event: Event) => void;
  onDrawAnnotation?: (event: Event) => void;
  onShowAnnotation?: (event: Event) => void;
  onExternalLink?: (event: Event) => void;
  /** Fired after foliate-js finishes creating the overlayer for a section.
   *  This is the right place to (re)attach user annotations — at this point
   *  `view.addAnnotation` for CFIs in this section will actually take effect.
   */
  onCreateOverlay?: (event: Event) => void;
}

export function useFoliateEvents(view: FoliateView | null, handlers?: FoliateEventHandlers) {
  const onLoad = handlers?.onLoad;
  const onRelocate = handlers?.onRelocate;
  const onDrawAnnotation = handlers?.onDrawAnnotation;
  const onShowAnnotation = handlers?.onShowAnnotation;
  const onExternalLink = handlers?.onExternalLink;
  const onCreateOverlay = handlers?.onCreateOverlay;

  useEffect(() => {
    if (!view) return;

    if (onLoad) view.addEventListener("load", onLoad);
    if (onRelocate) view.addEventListener("relocate", onRelocate);
    if (onDrawAnnotation) view.addEventListener("draw-annotation", onDrawAnnotation);
    if (onShowAnnotation) view.addEventListener("show-annotation", onShowAnnotation);
    if (onExternalLink) view.addEventListener("external-link", onExternalLink);
    if (onCreateOverlay) view.addEventListener("create-overlay", onCreateOverlay);

    return () => {
      if (onLoad) view.removeEventListener("load", onLoad);
      if (onRelocate) view.removeEventListener("relocate", onRelocate);
      if (onDrawAnnotation) view.removeEventListener("draw-annotation", onDrawAnnotation);
      if (onShowAnnotation) view.removeEventListener("show-annotation", onShowAnnotation);
      if (onExternalLink) view.removeEventListener("external-link", onExternalLink);
      if (onCreateOverlay) view.removeEventListener("create-overlay", onCreateOverlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, onLoad, onRelocate, onDrawAnnotation, onShowAnnotation, onExternalLink, onCreateOverlay]);
}
