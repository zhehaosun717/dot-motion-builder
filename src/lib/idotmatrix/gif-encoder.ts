export type GifFrame = {
  /** RGB bytes, width * height * 3. */
  rgb: Uint8Array;
  /** Frame delay in 1/100 s. */
  delayCs: number;
};

const MAX_COLORS = 256;
const MAX_CODES = 4096;

type IndexedFrames = { palette: number[]; frames: Uint8Array[] };

function reduceChannel(value: number, bits: number) {
  if (bits >= 8) return value;
  const levels = (1 << bits) - 1;
  return Math.round(Math.round((value / 255) * levels) * 255 / levels);
}

/**
 * One palette shared by every frame: per-frame palettes make LED colours jump between frames.
 * Exact colours are kept when they fit; otherwise channel precision drops until they do.
 */
function indexFrames(frames: GifFrame[]): IndexedFrames {
  for (let bits = 8; bits >= 1; bits--) {
    const lookup = new Map<number, number>();
    const palette: number[] = [];
    const indexed = frames.map(({ rgb }) => {
      const out = new Uint8Array(rgb.length / 3);
      for (let i = 0; i < out.length && lookup.size <= MAX_COLORS; i++) {
        const r = reduceChannel(rgb[i * 3], bits), g = reduceChannel(rgb[i * 3 + 1], bits), b = reduceChannel(rgb[i * 3 + 2], bits);
        const key = (r << 16) | (g << 8) | b;
        let index = lookup.get(key);
        if (index === undefined) {
          index = lookup.size;
          lookup.set(key, index);
          palette.push(r, g, b);
        }
        out[i] = index;
      }
      return out;
    });
    if (lookup.size <= MAX_COLORS) return { palette, frames: indexed };
  }
  throw new Error("unreachable: 1-bit channels always fit the palette");
}

/** GIF LZW, variable code width with the encoder-side early size bump the decoder expects. */
function lzwEncode(indices: Uint8Array, minCodeSize: number) {
  const clearCode = 1 << minCodeSize, endCode = clearCode + 1;
  const out: number[] = [];
  let codeSize = minCodeSize + 1, nextCode = endCode + 1;
  let table = new Map<number, number>();
  let bitBuffer = 0, bitCount = 0;
  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (nextCode === MAX_CODES) {
      emit(clearCode);
      table = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(endCode);
  if (bitCount > 0) out.push(bitBuffer & 0xff);
  return out;
}

function subBlocks(data: number[]) {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const block = data.slice(i, i + 255);
    out.push(block.length, ...block);
  }
  out.push(0);
  return out;
}

const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];

/** Minimal looping GIF89a: global palette, full frames, "do not dispose" so each frame paints over the last. */
export function encodeGif(width: number, height: number, frames: GifFrame[]): Uint8Array {
  if (frames.length === 0) throw new Error("GIF needs at least one frame");
  if (frames.some(f => f.rgb.length !== width * height * 3)) throw new Error("frame size does not match the canvas");

  const { palette, frames: indexed } = indexFrames(frames);
  const colorBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length / 3))));
  const tableBytes = 3 * (1 << colorBits);
  const minCodeSize = Math.max(2, colorBits);
  const out: number[] = [
    ..."GIF89a".split("").map(c => c.charCodeAt(0)),
    ...u16(width), ...u16(height),
    0x80 | ((colorBits - 1) << 4) | (colorBits - 1), 0, 0,
    ...palette, ...new Array(tableBytes - palette.length).fill(0),
    0x21, 0xff, 11, ..."NETSCAPE2.0".split("").map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0
  ];
  indexed.forEach((pixels, i) => {
    out.push(0x21, 0xf9, 4, 1 << 2, ...u16(Math.max(2, Math.round(frames[i].delayCs))), 0, 0);
    out.push(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0, minCodeSize);
    const encoded = subBlocks(lzwEncode(pixels, minCodeSize));
    for (const byte of encoded) out.push(byte);
  });
  out.push(0x3b);
  return Uint8Array.from(out);
}
