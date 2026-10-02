import fs from "node:fs";
import path from "node:path";
import { encodePng } from "@/lib/idotmatrix/png-encoder";
import { faceIconBitmap } from "./app-icon";

/** Build step: writes the 256x256 app icon PNG that electron-builder turns into the .exe icon. */
async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: write-icon <out.png>");
  const { buffer, size } = faceIconBitmap(8);
  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    // BGRA -> RGB; transparent corners become the page-dark backdrop.
    const alpha = buffer[i * 4 + 3] / 255;
    rgb[i * 3] = Math.round(buffer[i * 4 + 2] * alpha);
    rgb[i * 3 + 1] = Math.round(buffer[i * 4 + 1] * alpha);
    rgb[i * 3 + 2] = Math.round(buffer[i * 4] * alpha);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await encodePng(size, size, rgb, { allowPalette: false }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
