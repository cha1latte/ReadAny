import { useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  Image,
  useWindowDimensions,
} from "react-native";

interface Props {
  source: string | null;
  onClose: () => void;
}

export function ImageViewerModal({ source, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const startDistance = useRef(0);
  const startScale = useRef(1);
  const moved = useRef(false);
  // Reset zoom when a new image opens (or the viewer closes)
  const lastSource = useRef<string | null>(null);
  if (source !== lastSource.current) {
    lastSource.current = source;
    scaleRef.current = 1;
    setScale(1);
  }
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        moved.current = false;
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          startDistance.current = distance(touches[0], touches[1]);
          startScale.current = scaleRef.current;
        }
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2 && startDistance.current > 0) {
          moved.current = true;
          const next = Math.min(
            4,
            Math.max(
              1,
              (startScale.current * distance(touches[0], touches[1])) / startDistance.current,
            ),
          );
          scaleRef.current = next;
          setScale(next);
        } else if (touches.length === 1) {
          moved.current = Math.abs(event.nativeEvent.dx) > 8 || Math.abs(event.nativeEvent.dy) > 8;
        }
      },
      onPanResponderRelease: () => {
        startDistance.current = 0;
        if (!moved.current && scaleRef.current <= 1.05) onClose();
      },
    }),
  ).current;

  return (
    <Modal visible={!!source} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} {...responder.panHandlers}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        {source ? (
          <Image
            source={{ uri: source }}
            resizeMode="contain"
            style={{ width, height, transform: [{ scale }] }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function distance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }) {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  closeArea: { ...StyleSheet.absoluteFillObject },
});
