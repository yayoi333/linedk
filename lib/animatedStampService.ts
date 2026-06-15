// APNG (Animated PNG) generation and frame background removal service
// Developed in 2026 for high-quality animated LINE stamp creation.

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

export interface APNGInfo {
  width: number;
  height: number;
  byteSize: number;
  frameCount: number;
  totalDuration: number;
  delay: number;
  loops: number;
  fcTLCount: number;
  fdATCount: number;
  colors: number;
  colorReduced: boolean;
}

export interface APNGEncodeResult {
  bytes: Uint8Array;
  blob: Blob;
  colors: number;
  over: boolean;
  info: APNGInfo;
}

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

function crc32(buf: Uint8Array, off: number, len: number): number {
  let crc = 0xffffffff;
  for (let i = 0; i < len; i++) {
    crc = crcTable[(crc ^ buf[off + i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateBytes(u8: Uint8Array): Promise<Uint8Array> {
  const compressionCtor = globalThis.CompressionStream;
  if (!compressionCtor) {
    throw new Error('このブラウザはAPNG圧縮に必要なCompressionStreamに対応していません。');
  }
  const stream = new Blob([u8]).stream().pipeThrough(new compressionCtor('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 4 + data.length));
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function quantizeFrames(frames: Uint8Array[], maxColors: number): { palette: number[][]; indexed: Uint8Array[] } {
  const counts = new Map<number, number>();
  for (const frame of frames) {
    const u32 = new Uint32Array(frame.buffer, frame.byteOffset, frame.byteLength >> 2);
    for (let i = 0; i < u32.length; i++) {
      let pixel = u32[i];
      if ((pixel >>> 24) < 8) pixel = 0;
      counts.set(pixel, (counts.get(pixel) || 0) + 1);
    }
  }

  const hasTrans = counts.has(0);
  const opaque: Array<{ r: number; g: number; b: number; a: number; n: number }> = [];
  for (const [pixel, count] of counts) {
    if (pixel === 0) continue;
    opaque.push({
      r: pixel & 255,
      g: (pixel >>> 8) & 255,
      b: (pixel >>> 16) & 255,
      a: pixel >>> 24,
      n: count,
    });
  }

  const budget = Math.max(1, maxColors - (hasTrans ? 1 : 0));
  const boxes: typeof opaque[] = opaque.length ? [opaque] : [];
  const range = (box: typeof opaque) => {
    const mn = [255, 255, 255, 255];
    const mx = [0, 0, 0, 0];
    for (const color of box) {
      const values = [color.r, color.g, color.b, color.a];
      for (let k = 0; k < 4; k++) {
        if (values[k] < mn[k]) mn[k] = values[k];
        if (values[k] > mx[k]) mx[k] = values[k];
      }
    }
    let ch = 0;
    let width = -1;
    for (let k = 0; k < 4; k++) {
      if (mx[k] - mn[k] > width) {
        width = mx[k] - mn[k];
        ch = k;
      }
    }
    return { ch, width };
  };

  while (boxes.length < budget) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const { width } = range(boxes[i]);
      let population = 0;
      for (const color of boxes[i]) population += color.n;
      const score = width * Math.sqrt(population);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const box = boxes[bestIndex];
    const { ch } = range(box);
    const key = ['r', 'g', 'b', 'a'][ch] as 'r' | 'g' | 'b' | 'a';
    box.sort((a, b) => a[key] - b[key]);
    let total = 0;
    for (const color of box) total += color.n;
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].n;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(bestIndex, 1, box.slice(0, cut), box.slice(cut));
  }

  const palette: number[][] = [];
  if (hasTrans) palette.push([0, 0, 0, 0]);
  for (const box of boxes) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (const color of box) {
      r += color.r * color.n;
      g += color.g * color.n;
      b += color.b * color.n;
      a += color.a * color.n;
      n += color.n;
    }
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)]);
  }

  const lookup = new Map<number, number>();
  const nearest = (pixel: number) => {
    const hit = lookup.get(pixel);
    if (hit !== undefined) return hit;
    const r = pixel & 255;
    const g = (pixel >>> 8) & 255;
    const b = (pixel >>> 16) & 255;
    const a = pixel >>> 24;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      const distance = (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2 + 2 * (color[3] - a) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    lookup.set(pixel, bestIndex);
    return bestIndex;
  };

  if (hasTrans) lookup.set(0, 0);
  const indexed = frames.map((frame) => {
    const u32 = new Uint32Array(frame.buffer, frame.byteOffset, frame.byteLength >> 2);
    const out = new Uint8Array(u32.length);
    for (let i = 0; i < u32.length; i++) {
      let pixel = u32[i];
      if ((pixel >>> 24) < 8) pixel = 0;
      out[i] = nearest(pixel);
    }
    return out;
  });

  return { palette, indexed };
}

export function diffRect(a: Uint8Array, b: Uint8Array, w: number, h: number, bpp: number): { x: number; y: number; w: number; h: number } | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * bpp;
    for (let x = 0; x < w; x++) {
      const offset = rowOffset + x * bpp;
      let same = true;
      for (let k = 0; k < bpp; k++) {
        if (a[offset + k] !== b[offset + k]) {
          same = false;
          break;
        }
      }
      if (!same) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function regionRaw(img: Uint8Array, w: number, rect: { x: number; y: number; w: number; h: number }, bpp: number): Uint8Array {
  const out = new Uint8Array(rect.h * (1 + rect.w * bpp));
  let position = 0;
  for (let y = 0; y < rect.h; y++) {
    out[position++] = 0;
    const src = ((rect.y + y) * w + rect.x) * bpp;
    out.set(img.subarray(src, src + rect.w * bpp), position);
    position += rect.w * bpp;
  }
  return out;
}

export async function buildAPNG({
  w,
  h,
  frames,
  delays,
  loops,
  colors,
}: {
  w: number;
  h: number;
  frames: Uint8Array[];
  delays: number[];
  loops: number;
  colors: number;
}): Promise<Uint8Array> {
  if (frames.length === 0) {
    throw new Error('APNG creation requires at least one frame.');
  }
  if (!Number.isInteger(loops) || loops < 1 || loops > 4) {
    throw new Error('loop 0 は使用できません。APNGのループ回数は1〜4回にしてください。');
  }

  let imgs: Uint8Array[];
  let bpp: number;
  let palette: number[][] | null = null;
  if (colors > 0) {
    const quantized = quantizeFrames(frames, colors);
    imgs = quantized.indexed;
    palette = quantized.palette;
    bpp = 1;
  } else {
    imgs = frames;
    bpp = 4;
  }

  const u32be = (...values: number[]) => {
    const data = new Uint8Array(values.length * 4);
    const view = new DataView(data.buffer);
    values.forEach((value, index) => view.setUint32(index * 4, value));
    return data;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, w);
  ihdrView.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = palette ? 3 : 6;

  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  parts.push(pngChunk('IHDR', ihdr));
  parts.push(pngChunk('acTL', u32be(frames.length, loops)));

  if (palette) {
    const plte = new Uint8Array(palette.length * 3);
    const trns = new Uint8Array(palette.length);
    palette.forEach((color, index) => {
      plte.set(color.slice(0, 3), index * 3);
      trns[index] = color[3];
    });
    parts.push(pngChunk('PLTE', plte));
    parts.push(pngChunk('tRNS', trns));
  }

  let sequence = 0;
  for (let i = 0; i < imgs.length; i++) {
    const rect = i === 0
      ? { x: 0, y: 0, w, h }
      : (diffRect(imgs[i - 1], imgs[i], w, h, bpp) || { x: 0, y: 0, w: 1, h: 1 });

    const fctl = new Uint8Array(26);
    const view = new DataView(fctl.buffer);
    view.setUint32(0, sequence++);
    view.setUint32(4, rect.w);
    view.setUint32(8, rect.h);
    view.setUint32(12, rect.x);
    view.setUint32(16, rect.y);
    view.setUint16(20, Math.max(1, Math.round(delays[i])));
    view.setUint16(22, 1000);
    fctl[24] = 0;
    fctl[25] = 0;
    parts.push(pngChunk('fcTL', fctl));

    const compressed = await deflateBytes(regionRaw(imgs[i], w, rect, bpp));
    if (i === 0) {
      parts.push(pngChunk('IDAT', compressed));
    } else {
      const data = new Uint8Array(4 + compressed.length);
      new DataView(data.buffer).setUint32(0, sequence++);
      data.set(compressed, 4);
      parts.push(pngChunk('fdAT', data));
    }
  }

  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return concatBytes(parts);
}

export async function encodeAutoAPNG({
  w,
  h,
  frames,
  delays,
  loops,
  maxBytes = 1024 * 1024,
}: {
  w: number;
  h: number;
  frames: Uint8Array[];
  delays: number[];
  loops: number;
  maxBytes?: number;
}): Promise<APNGEncodeResult> {
  if (!Number.isInteger(loops) || loops < 1 || loops > 4) {
    throw new Error('loop 0 は使用できません。APNGのループ回数は1〜4回にしてください。');
  }

  let best: { bytes: Uint8Array; colors: number } | null = null;
  for (const colors of [0, 256, 128, 64, 32, 16]) {
    const bytes = await buildAPNG({ w, h, frames, delays, loops, colors });
    if (!best || bytes.length < best.bytes.length) best = { bytes, colors };
    if (bytes.length <= maxBytes) {
      const delay = Math.max(1, Math.round(delays[0] ?? 0));
      return {
        bytes,
        blob: new Blob([bytes], { type: 'image/png' }),
        colors,
        over: false,
        info: {
          width: w,
          height: h,
          byteSize: bytes.length,
          frameCount: frames.length,
          totalDuration: (delay * frames.length * loops) / 1000,
          delay,
          loops,
          fcTLCount: frames.length,
          fdATCount: Math.max(0, frames.length - 1),
          colors,
          colorReduced: colors > 0,
        },
      };
    }
  }

  if (!best) {
    throw new Error('APNGの生成に失敗しました');
  }
  const delay = Math.max(1, Math.round(delays[0] ?? 0));
  return {
    bytes: best.bytes,
    blob: new Blob([best.bytes], { type: 'image/png' }),
    colors: best.colors,
    over: true,
    info: {
      width: w,
      height: h,
      byteSize: best.bytes.length,
      frameCount: frames.length,
      totalDuration: (delay * frames.length * loops) / 1000,
      delay,
      loops,
      fcTLCount: frames.length,
      fdATCount: Math.max(0, frames.length - 1),
      colors: best.colors,
      colorReduced: best.colors > 0,
    },
  };
}
