export function normalizeRoomCode(value: string) {
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

  return letters.length < 2 ? letters : `${letters}-${digits}`;
}

export function isCompleteRoomCode(value: string) {
  return /^[A-Z]{2}-\d{4}$/.test(normalizeRoomCode(value));
}
