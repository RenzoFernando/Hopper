const VERSION = 4;
const SIZE = 17 + 4 * VERSION;
const DATA_CODEWORDS = 80;
const ECC_CODEWORDS = 20;
const FORMAT_MASK = 0x5412;
const FORMAT_POLY = 0x537;
const MASK_PATTERN = 0;

type QrMatrix = Array<Array<boolean | null>>;

function appendBits(buffer: number[], value: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) {
    buffer.push((value >>> index) & 1);
  }
}

function encodeData(text: string) {
  const bytes = Array.from(new TextEncoder().encode(String(text || "")));

  if (bytes.length > 78) {
    throw new Error("El enlace es demasiado largo para el QR local de Hopper.");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | (bits[offset + bit] ?? 0);
    data.push(value);
  }

  let pad = 0;
  while (data.length < DATA_CODEWORDS) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
    pad += 1;
  }
  return data;
}

function gfMultiply(first: number, second: number) {
  let a = first;
  let b = second;
  let result = 0;
  while (b > 0) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

function generatorPolynomial(degree: number) {
  let polynomial = [1];
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let position = 0; position < polynomial.length; position += 1) {
      next[position] = (next[position] ?? 0) ^ (polynomial[position] ?? 0);
      next[position + 1] = (next[position + 1] ?? 0) ^ gfMultiply(polynomial[position] ?? 0, root);
    }
    polynomial = next;
    root = gfMultiply(root, 2);
  }
  return polynomial;
}

function reedSolomon(data: number[]) {
  const generator = generatorPolynomial(ECC_CODEWORDS);
  const remainder = new Array<number>(ECC_CODEWORDS).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < ECC_CODEWORDS; index += 1) {
      remainder[index] = (remainder[index] ?? 0) ^ gfMultiply(generator[index + 1] ?? 0, factor);
    }
  }
  return remainder;
}

function emptyMatrix(): QrMatrix {
  return Array.from({ length: SIZE }, () => Array<boolean | null>(SIZE).fill(null));
}

function setCell(matrix: QrMatrix, row: number, col: number, value: boolean) {
  const line = matrix[row];
  if (line) line[col] = value;
}

function getCell(matrix: QrMatrix, row: number, col: number) {
  return matrix[row]?.[col] ?? null;
}

function setupFinder(matrix: QrMatrix, row: number, col: number) {
  for (let dr = -1; dr <= 7; dr += 1) {
    const y = row + dr;
    if (y < 0 || y >= SIZE) continue;
    for (let dc = -1; dc <= 7; dc += 1) {
      const x = col + dc;
      if (x < 0 || x >= SIZE) continue;
      const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      setCell(matrix, y, x, dark);
    }
  }
}

function setupAlignment(matrix: QrMatrix) {
  const centers = [6, 26];
  for (const row of centers) {
    for (const col of centers) {
      if (getCell(matrix, row, col) !== null) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          setCell(matrix, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
}

function setupTiming(matrix: QrMatrix) {
  for (let index = 8; index < SIZE - 8; index += 1) {
    if (getCell(matrix, index, 6) === null) setCell(matrix, index, 6, index % 2 === 0);
    if (getCell(matrix, 6, index) === null) setCell(matrix, 6, index, index % 2 === 0);
  }
}

function bchFormat(value: number) {
  let data = value << 10;
  while (Math.floor(Math.log2(data)) >= Math.floor(Math.log2(FORMAT_POLY))) {
    data ^= FORMAT_POLY << (Math.floor(Math.log2(data)) - Math.floor(Math.log2(FORMAT_POLY)));
  }
  return ((value << 10) | data) ^ FORMAT_MASK;
}

function setupFormat(matrix: QrMatrix, mask: number, test = false) {
  const format = bchFormat((1 << 3) | mask);
  for (let index = 0; index < 15; index += 1) {
    const dark = !test && ((format >> index) & 1) === 1;
    if (index < 6) setCell(matrix, index, 8, dark);
    else if (index < 8) setCell(matrix, index + 1, 8, dark);
    else setCell(matrix, SIZE - 15 + index, 8, dark);

    if (index < 8) setCell(matrix, 8, SIZE - index - 1, dark);
    else if (index < 9) setCell(matrix, 8, 15 - index, dark);
    else setCell(matrix, 8, 15 - index - 1, dark);
  }
  setCell(matrix, SIZE - 8, 8, !test);
}

function maskBit(mask: number, row: number, col: number) {
  if (mask === 0) return (row + col) % 2 === 0;
  if (mask === 1) return row % 2 === 0;
  if (mask === 2) return col % 3 === 0;
  if (mask === 3) return (row + col) % 3 === 0;
  if (mask === 4) return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
  if (mask === 5) return row * col % 2 + row * col % 3 === 0;
  if (mask === 6) return (row * col % 2 + row * col % 3) % 2 === 0;
  return ((row * col) % 3 + (row + col) % 2) % 2 === 0;
}

function mapData(matrix: QrMatrix, codewords: number[], mask: number) {
  let byteIndex = 0;
  let bitIndex = 7;
  let row = SIZE - 1;
  let direction = -1;

  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = col - offset;
        if (getCell(matrix, row, x) !== null) continue;
        let dark = false;
        const codeword = codewords[byteIndex];
        if (codeword !== undefined) dark = ((codeword >>> bitIndex) & 1) === 1;
        if (maskBit(mask, row, x)) dark = !dark;
        setCell(matrix, row, x, dark);
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row < 0 || row >= SIZE) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

export function makeQrMatrix(text: string) {
  const data = encodeData(text);
  const codewords = [...data, ...reedSolomon(data)];
  const matrix = emptyMatrix();
  setupFinder(matrix, 0, 0);
  setupFinder(matrix, SIZE - 7, 0);
  setupFinder(matrix, 0, SIZE - 7);
  setupAlignment(matrix);
  setupTiming(matrix);
  setupFormat(matrix, MASK_PATTERN, true);
  mapData(matrix, codewords, MASK_PATTERN);
  setupFormat(matrix, MASK_PATTERN, false);
  return matrix;
}

export function renderQr(canvas: HTMLCanvasElement, text: string, size = 240) {
  const matrix = makeQrMatrix(text);
  const quiet = 4;
  const total = SIZE + quiet * 2;
  const scale = Math.max(1, Math.floor(size / total));
  const pixels = total * scale;
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No fue posible preparar el canvas del QR.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = "#202123";
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (matrix[row]?.[col]) context.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
    }
  }
}
