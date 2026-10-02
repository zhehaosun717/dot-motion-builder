import { crc32 } from "@/lib/idotmatrix/protocol";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

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

/** Minimal 8-bit RGB PNG — the panel's DIY mode takes one PNG per frame. */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  if (rgb.length !== width * height * 3) throw new Error("pixel data does not match the image size");
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Uint8Array.from([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  return Uint8Array.from([
    ...SIGNATURE,
    ...chunk("IHDR", header),
    ...chunk("IDAT", await deflate(raw)),
    ...chunk("IEND", new Uint8Array(0))
  ]);
}
