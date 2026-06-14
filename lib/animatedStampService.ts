// APNG (Animated PNG) generation and frame background removal service
// Developed in 2026 for high-quality animated LINE stamp creation.

export interface AnimatedStampFrame {
  pngBuffer: ArrayBuffer;
}

export interface AnimatedStampResult {
  id: string;
  cellIndex: number;
  row: number;
  col: number;
  apngBlob: Blob;
  apngUrl: string;
  isExcluded: boolean;
  fileName: string;
}

/**
 * Parses hex color like '#ffffff' into RGB constituents.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  if (isNaN(bigint)) {
    return { r: 255, g: 255, b: 255 };
  }
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

/**
 * Removes background color from video frame ImageData.
 * Supports both full-canvas chromakey (everywhere) and edge-based floodfill (boundary only).
 */
export function removeBackgroundForAnimFrame(
  imageData: ImageData,
  bgColorSelect: string, // "auto" or hex color string
  tolerance: number,
  algorithm: 'chromakey' | 'floodfill'
): ImageData {
  const { width, height, data } = imageData;
  const tol = tolerance * 3; // sum of absolute differences scale

  let bgR = 255, bgG = 255, bgB = 255;

  if (bgColorSelect === 'auto') {
    // Sample top-left corner
    bgR = data[0];
    bgG = data[1];
    bgB = data[2];
  } else {
    const rgb = hexToRgb(bgColorSelect);
    bgR = rgb.r;
    bgG = rgb.g;
    bgB = rgb.b;
  }

  const isCloseToBg = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
    return diff < tol;
  };

  if (algorithm === 'chromakey') {
    // Apply background removal to every pixel in the frame
    for (let i = 0; i < data.length; i += 4) {
      if (isCloseToBg(i)) {
        data[i + 3] = 0; // transparantize
      }
    }
  } else {
    // Edge-seeded boundary floodfill
    const visited = new Uint8Array(width * height);
    const stack: [number, number][] = [];

    const getIdx = (x: number, y: number) => (y * width + x) * 4;

    // Seed top and bottom rows
    for (let x = 0; x < width; x++) {
      [0, height - 1].forEach(y => {
        const idx = getIdx(x, y);
        if (isCloseToBg(idx)) {
          stack.push([x, y]);
          visited[y * width + x] = 1;
        }
      });
    }

    // Seed left and right columns
    for (let y = 0; y < height; y++) {
      [0, width - 1].forEach(x => {
        const idx = getIdx(x, y);
        const vIdx = y * width + x;
        if (visited[vIdx]) return;
        if (isCloseToBg(idx)) {
          stack.push([x, y]);
          visited[vIdx] = 1;
        }
      });
    }

    // Floodfill recursion stack
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const idx = getIdx(x, y);
      data[idx + 3] = 0; // delete background pixel

      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nVisitedIdx = ny * width + nx;
          if (!visited[nVisitedIdx]) {
            const nIdx = getIdx(nx, ny);
            if (isCloseToBg(nIdx)) {
              visited[nVisitedIdx] = 1;
              stack.push([nx, ny]);
            }
          }
        }
      }
    }
  }

  return imageData;
}

interface PNGChunk {
  length: number;
  type: string;
  data: Uint8Array;
  crc: number;
}

/**
 * Parses raw PNG ArrayBuffer into structural chunks.
 */
export function parsePNG(buffer: ArrayBuffer): PNGChunk[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const chunks: PNGChunk[] = [];

  // Skip standard 8-byte PNG signature
  let pos = 8;
  while (pos < buffer.byteLength) {
    if (pos + 8 > buffer.byteLength) break;
    const length = view.getUint32(pos, false);
    const type = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7]
    );
    if (pos + 12 + length > buffer.byteLength) break;
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    const crc = view.getUint32(pos + 8 + length, false);
    chunks.push({ length, type, data, crc });
    pos += 12 + length;
  }
  return chunks;
}

// Generate fast lookup CRC32 table
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Calculates Chunk CRC32 according to ANSI X3.66 specifications.
 */
export function calculateCRC32(type: string, data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < 4; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ type.charCodeAt(i)) & 0xff];
  }
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getFrameDelay(fps: number, frameCount: number, durationSeconds?: number): { numerator: number; denominator: number } {
  if (durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return {
      numerator: Math.max(1, Math.round((durationSeconds * 1000) / frameCount)),
      denominator: 1000,
    };
  }

  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 1;
  return {
    numerator: Math.max(1, Math.round(1000 / safeFps)),
    denominator: 1000,
  };
}

/**
 * Combines parsed PNG frame ArrayBuffers to assemble a valid Animated PNG (APNG) Blob.
 * Correctly configures acTL (Animation Control), fcTL (Frame Control), and fdAT (Frame Data Chunks).
 */
export function assembleAPNG(frames: ArrayBuffer[], fps: number, durationSeconds?: number): Blob {
  if (frames.length === 0) {
    throw new Error('APNG creation requires at least one frame.');
  }

  const chunksByFrame = frames.map(f => parsePNG(f));
  const outputParts: Uint8Array[] = [];

  // 1. Write official PNG signature (8 bytes)
  outputParts.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  // 2. Extract and write IHDR from first frame
  const frame0Chunks = chunksByFrame[0];
  const ihdrChunk = frame0Chunks.find(c => c.type === 'IHDR');
  if (!ihdrChunk) {
    throw new Error('Specified PNG frames lack a valid IHDR chunk.');
  }

  // helper function to format and stage chunks to output
  function writeChunk(type: string, data: Uint8Array) {
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) {
      header[4 + i] = type.charCodeAt(i);
    }
    const crc = calculateCRC32(type, data);
    const footer = new Uint8Array(4);
    const footerView = new DataView(footer.buffer);
    footerView.setUint32(0, crc, false);

    outputParts.push(header);
    outputParts.push(data);
    outputParts.push(footer);
  }

  writeChunk('IHDR', ihdrChunk.data);

  // 3. Write acTL (Animation Control Chunk)
  const numFrames = frames.length;
  const numPlays = 0; // Infinite loop parameter
  const acTlPayload = new Uint8Array(8);
  const acTlView = new DataView(acTlPayload.buffer);
  acTlView.setUint32(0, numFrames, false);
  acTlView.setUint32(4, numPlays, false);
  writeChunk('acTL', acTlPayload);

  // Read dimensions from original IHDR payload
  const ihdrView = new DataView(
    ihdrChunk.data.buffer,
    ihdrChunk.data.byteOffset,
    ihdrChunk.data.byteLength
  );
  const width = ihdrView.getUint32(0, false);
  const height = ihdrView.getUint32(4, false);

  let sequenceNumber = 0;
  const frameDelay = getFrameDelay(fps, numFrames, durationSeconds);

  // 4. Sequence all frames
  for (let i = 0; i < numFrames; i++) {
    const fChunks = chunksByFrame[i];

    // Build fcTL frame controller chunk
    const fcTlPayload = new Uint8Array(26);
    const fcTlView = new DataView(fcTlPayload.buffer);
    fcTlView.setUint32(0, sequenceNumber++, false); // Sequence sequence number
    fcTlView.setUint32(4, width, false); // Width dimension
    fcTlView.setUint32(8, height, false); // Height dimension
    fcTlView.setUint32(12, 0, false); // X coordinate offset
    fcTlView.setUint16(20, frameDelay.numerator, false); // Numerator of delay
    fcTlView.setUint16(22, frameDelay.denominator, false); // Denominator of delay
    fcTlView.setUint8(24, 0); // dispose_op: 0 (APNG_DISPOSE_OP_NONE) for full-canvas frames
    fcTlView.setUint8(25, 0); // blend_op: 0 (APNG_BLEND_OP_SOURCE) to fully overwrite source RGBA values

    writeChunk('fcTL', fcTlPayload);

    // Filter for IDAT pixel data chunking
    const idatChunks = fChunks.filter(c => c.type === 'IDAT');

    if (i === 0) {
      // Frame 0 has standard IDAT chunk(s) for backward rendering compatibility
      for (const idat of idatChunks) {
        writeChunk('IDAT', idat.data);
      }
    } else {
      // Frames i > 0 map onto fdAT frame data chunks
      for (const idat of idatChunks) {
        const fdAtPayload = new Uint8Array(4 + idat.data.length);
        const fdAtView = new DataView(fdAtPayload.buffer);
        fdAtView.setUint32(0, sequenceNumber++, false); // Sequence chunk
        fdAtPayload.set(idat.data, 4); // Copy original IDAT contents
        writeChunk('fdAT', fdAtPayload);
      }
    }
  }

  // 5. Clone supporting non-pixel chunks from Frame 0 (excluding metadata we override)
  for (const chunk of frame0Chunks) {
    if (
      chunk.type !== 'IHDR' &&
      chunk.type !== 'IDAT' &&
      chunk.type !== 'IEND' &&
      chunk.type !== 'acTL' &&
      chunk.type !== 'fcTL' &&
      chunk.type !== 'fdAT'
    ) {
      writeChunk(chunk.type, chunk.data);
    }
  }

  // 6. Conclude with IEND termination chunk
  writeChunk('IEND', new Uint8Array(0));

  return new Blob(outputParts, { type: 'image/png' });
}
