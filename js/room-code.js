function normalizeRoomCode(value) {
  const source = String(value || "").toUpperCase();
  let letters = "";
  let digits = "";

  for (const character of source) {
    if (letters.length < 2) {
      if (character >= "A" && character <= "Z") {
        letters += character;
      }
      continue;
    }

    if (character >= "0" && character <= "9" && digits.length < 4) {
      digits += character;
    }
  }

  if (letters.length < 2) {
    return letters;
  }

  return `${letters}-${digits}`;
}

function isCompleteRoomCode(value) {
  return /^[A-Z]{2}-\d{4}$/.test(normalizeRoomCode(value));
}

function bindRoomCodeInput(input, onChange = null) {
  if (!input) {
    return;
  }

  const notify = () => {
    if (typeof onChange === "function") {
      onChange(input.value);
    }
  };

  input.addEventListener("input", () => {
    const normalized = normalizeRoomCode(input.value);

    if (input.value !== normalized) {
      input.value = normalized;
    }

    const end = input.value.length;
    input.setSelectionRange?.(end, end);
    notify();
  });

  input.addEventListener("keydown", (event) => {
    if (
      event.key === "Backspace"
      && input.selectionStart === 3
      && input.selectionEnd === 3
      && /^[A-Z]{2}-$/.test(input.value)
    ) {
      event.preventDefault();
      input.value = input.value.slice(0, 1);
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
      notify();
    }
  });
}

export { bindRoomCodeInput, isCompleteRoomCode, normalizeRoomCode };
