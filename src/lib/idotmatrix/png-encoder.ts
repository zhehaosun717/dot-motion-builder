import { crc32 } from "@/lib/idotmatrix/protocol";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_PALETTE = 256;
const MAX_NIBBLE_PALETTE = 16;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_INDEXED = 3;

export type PngOptions = {
  /**
   * Store frames with <= 256 colours as an indexed PNG (1 byte or a nibble per pixel instead of 3).
   * Editor frames are a few dozen colours, so this roughly halves the bytes the BLE link must carry.
   */
  allowPalette?: boolean;
};

function u32(value: number) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: Uint8Array): number[] {
  const typed = Uint8Array.from([...type].map(c => c.charCodeAt(0)));
  const body = new Uint8Array(typed.length + data.length);
  body.set(typed);
  body.set(data, typed.length);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** zlib-wrapped deflate via the platform's CompressionStream (browsers and Node 18+). */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Palette and per-pixel indices, or null when the image has more than 256 colours. */
function indexColours(rgb: Uint8Array): { palette: number[]; indices: Uint8Array } | null {
  const lookup = new Map<number, number>();
  const palette: number[] = [];
  const indices = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < indices.length; i++) {
    const key = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
    let index = lookup.get(key);
    if (index === undefined) {
      if (lookup.size === MAX_PALETTE) return null;
      index = lookup.size;
      lookup.set(key, index);
      palette.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    }
    indices[i] = index;
  }
  return { palette, indices };
}

/** Scanlines with filter byte 0; nibble-packed when 4 bits per pixel suffice. */
function scanlines(width: number, height: number, bytesPerRow: number, writeRow: (row: Uint8Array, y: number) => void) {
  const raw = new Uint8Array(height * (bytesPerRow + 1));
  for (let y = 0; y < height; y++) writeRow(raw.subarray(y * (bytesPerRow + 1) + 1, (y + 1) * (bytesPerRow + 1)), y);
  return raw;
}

/** Minimal PNG for the panel's DIY mode: indexed when the frame allows it, otherwise 8-bit RGB. */
export async function encodePng(width: number, height: number, rgb: Uint8Array, options: PngOptions = {}): Promise<Uint8Array> {
  if (rgb.length !== width * height * 3) throw new Error("pixel data does not match the image size");
  const indexed = options.allowPalette === false ? null : indexColours(rgb);

  let header: number[];
  let raw: Uint8Array;
  let palette: number[] = [];
  if (indexed) {
    const depth = indexed.palette.length / 3 <= MAX_NIBBLE_PALETTE ? 4 : 8;
    const bytesPerRow = Math.ceil((width * depth) / 8);
    raw = scanlines(width, height, bytesPerRow, (row, y) => {
      for (let x = 0; x < width; x++) {
        const index = indexed.indices[y * width + x];
        if (depth === 8) row[x] = index;
        else row[x >> 1] |= x & 1 ? index : index << 4;
      }
    });
    header = [...u32(width), ...u32(height), depth, COLOR_TYPE_INDEXED, 0, 0, 0];
    palette = indexed.palette;
  } else {
    const stride = width * 3;
    raw = scanlines(width, height, stride, (row, y) => row.set(rgb.subarray(y * stride, (y + 1) * stride)));
    header = [...u32(width), ...u32(height), 8, COLOR_TYPE_RGB, 0, 0, 0];
  }

  return Uint8Array.from([
    ...SIGNATURE,
    ...chunk("IHDR", Uint8Array.from(header)),
    ...(palette.length ? chunk("PLTE", Uint8Array.from(palette)) : []),
    ...chunk("IDAT", await deflate(raw)),
    ...chunk("IEND", new Uint8Array(0))
  ]);
}
