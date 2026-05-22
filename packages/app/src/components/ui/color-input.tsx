/**
 * ColorInput — hex color picker with native swatch + text input.
 */
import { useCallback, useRef } from "react";

interface ColorInputProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export function ColorInput({ value, onChange, label }: ColorInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let v = e.target.value;
      // Auto-prefix # if missing
      if (v && !v.startsWith("#")) v = "#" + v;
      // Only emit if valid hex
      if (HEX_REGEX.test(v)) {
        onChange(v);
      }
    },
    [onChange],
  );

  const handlePickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      )}
      <button
        type="button"
        className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: value }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={handlePickerChange}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </button>
      <input
        type="text"
        value={value}
        onChange={handleTextChange}
        className="h-7 w-20 rounded-md border border-border bg-background px-2 text-xs text-foreground font-mono"
        spellCheck={false}
      />
    </div>
  );
}
