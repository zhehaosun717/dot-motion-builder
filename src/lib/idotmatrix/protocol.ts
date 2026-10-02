import { UPLOAD_CHUNK_BYTES } from "@/lib/idotmatrix/constants";

const GIF_HEADER_BYTES = 16;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** zlib CRC-32, as the firmware validates uploaded GIFs with it. */
export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const SCREEN_ON = Uint8Array.of(5, 0, 7, 1, 1);
/** DIY ("draw") mode accepts single PNG frames. Entering it blanks the panel for ~200–400 ms (hardware). */
export const DIY_MODE_ON = Uint8Array.of(5, 0, 4, 1, 1);

const IMAGE_HEADER_BYTES = 9;

/**
 * Frames a PNG for DIY mode: per 4 KiB chunk a 9-byte header of
 * uint16 packet length, 00 00, 00 first / 02 continuation, uint32 PNG length (DeskDot, hardware-verified).
 */
export function buildImageFrame(png: Uint8Array): Uint8Array {
  if (png.length === 0) throw new Error("PNG is empty");
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < png.length; offset += UPLOAD_CHUNK_BYTES) {
    const body = png.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
    const part = new Uint8Array(IMAGE_HEADER_BYTES + body.length);
    const view = new DataView(part.buffer);
    view.setUint16(0, part.length, true);
    part.set([0, 0, offset === 0 ? 0 : 2], 2);
    view.setUint32(5, png.length, true);
    part.set(body, IMAGE_HEADER_BYTES);
    parts.push(part);
  }
  const frame = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => { frame.set(part, offset); return offset + part.length; }, 0);
  return frame;
}

/** The panel answers each DIY frame with 05 00 00 00 01, ~200 ms after the write. */
export function isImageAck(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 5 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0;
}

/**
 * Frames a GIF for upload: per 4 KiB chunk a 16-byte header of
 * uint16 chunk length, 01 00, 00 first / 02 continuation, uint32 GIF length, uint32 CRC-32, 05 00 0D.
 * The header tail matches DeskDot's hardware-verified encoder (vendor GIF type 13).
 */
export function buildGifChunks(gif: Uint8Array): Uint8Array[] {
  if (gif.length === 0) throw new Error("GIF is empty");
  const crc = crc32(gif);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < gif.length; offset += UPLOAD_CHUNK_BYTES) {
    const body = gif.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
    const chunk = new Uint8Array(GIF_HEADER_BYTES + body.length);
    const view = new DataView(chunk.buffer);
    view.setUint16(0, chunk.length, true);
    chunk.set([1, 0, offset === 0 ? 0 : 2], 2);
    view.setUint32(5, gif.length, true);
    view.setUint32(9, crc, true);
    chunk.set([5, 0, 13], 13);
    chunk.set(body, GIF_HEADER_BYTES);
    chunks.push(chunk);
  }
  return chunks;
}

/** The panel answers every GIF chunk with 05 00 01 00 xx (01 more expected, 03/00 complete). */
export function isGifAck(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 5 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
}
