import type { ChangeEvent, KeyboardEvent } from "react";
import { normalizeRoomCode } from "../../lib/room-code";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
};

export function RoomCodeInput({ id, value, onChange, disabled = false, ariaLabel, autoFocus = false }: Props) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const normalized = normalizeRoomCode(input.value);
    onChange(normalized);
    requestAnimationFrame(() => {
      const end = normalized.length;
      input.setSelectionRange?.(end, end);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (
      event.key === "Backspace"
      && input.selectionStart === 3
      && input.selectionEnd === 3
      && /^[A-Z]{2}-$/.test(value)
    ) {
      event.preventDefault();
      const nextValue = value.slice(0, 1);
      onChange(nextValue);
      requestAnimationFrame(() => {
        const end = nextValue.length;
        input.setSelectionRange?.(end, end);
      });
    }
  };

  return <input id={id} type="text" inputMode="text" maxLength={7} pattern="[A-Za-z]{2}-[0-9]{4}" autoComplete="off" autoCapitalize="characters" enterKeyHint="go" spellCheck={false} aria-label={ariaLabel} placeholder="XX-0000" value={value} disabled={disabled} autoFocus={autoFocus} onChange={handleChange} onKeyDown={handleKeyDown} />;
}
