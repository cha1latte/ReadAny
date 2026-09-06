import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { CONTROLS_TIMEOUT } from "./reader-constants";

export const TOOLBAR_HIDE_OFFSET = 100;

/** Animate retained toolbar views without doing animation work while idle. */
export function useReaderControls() {
  const [showControls, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarAnim = useRef(new Animated.Value(TOOLBAR_HIDE_OFFSET)).current;

  const {
    topControlsTranslate,
    topControlsOpacity,
    bottomControlsTranslate,
    bottomControlsOpacity,
    auxToolsTranslate,
    auxToolsOpacity,
  } = useMemo(() => {
    const topControlsTranslate = toolbarAnim.interpolate({
      inputRange: [0, TOOLBAR_HIDE_OFFSET],
      outputRange: [0, -10],
    });
    const topControlsOpacity = toolbarAnim.interpolate({
      inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.5, TOOLBAR_HIDE_OFFSET],
      outputRange: [1, 0.28, 0],
    });
    const bottomControlsTranslate = toolbarAnim.interpolate({
      inputRange: [0, TOOLBAR_HIDE_OFFSET],
      outputRange: [0, 12],
    });
    const bottomControlsOpacity = toolbarAnim.interpolate({
      inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.5, TOOLBAR_HIDE_OFFSET],
      outputRange: [1, 0.28, 0],
    });
    const auxToolsTranslate = toolbarAnim.interpolate({
      inputRange: [0, TOOLBAR_HIDE_OFFSET],
      outputRange: [0, 14],
    });
    const auxToolsOpacity = toolbarAnim.interpolate({
      inputRange: [0, TOOLBAR_HIDE_OFFSET * 0.55, TOOLBAR_HIDE_OFFSET],
      outputRange: [1, 0.24, 0],
    });
    return {
      topControlsTranslate,
      topControlsOpacity,
      bottomControlsTranslate,
      bottomControlsOpacity,
      auxToolsTranslate,
      auxToolsOpacity,
    };
  }, [toolbarAnim]);

  const setShowControls = useCallback(
    function updateVisibility(next: SetStateAction<boolean>) {
      const visible = typeof next === "function" ? next(visibleRef.current) : next;
      if (visible === visibleRef.current) return;
      visibleRef.current = visible;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      animationRef.current?.stop();
      // The views are already mounted: start the native animation from the event,
      // before React commits the reader's visibility update.
      const animation = Animated.timing(toolbarAnim, {
        toValue: visible ? 0 : TOOLBAR_HIDE_OFFSET,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animationRef.current = animation;
      animation.start();
      setVisible(visible);
      if (visible) timerRef.current = setTimeout(() => updateVisibility(false), CONTROLS_TIMEOUT);
    },
    [toolbarAnim],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      animationRef.current?.stop();
    },
    [],
  );

  const toggleControls = useCallback(
    () => setShowControls((visible) => !visible),
    [setShowControls],
  );
  return {
    showControls,
    setShowControls,
    topControlsTranslate,
    topControlsOpacity,
    bottomControlsTranslate,
    bottomControlsOpacity,
    auxToolsTranslate,
    auxToolsOpacity,
    toggleControls,
  };
}
