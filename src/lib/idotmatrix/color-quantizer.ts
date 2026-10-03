/**
 * Median-cut palette for frames with more than 256 colours (imported photos): split the colour box with
 * the widest channel range at its population median until there are maxColors boxes, then use each box's
 * weighted mean. Unlike uniform bit reduction it spends palette entries where the image's colours are,
 * so dark and subtle tones survive.
 */
type Entry = { r: number; g: number; b: number; count: number };
type Box = Entry[];

const channels = ["r", "g", "b"] as const;

function widestChannel(box: Box) {
  let best: (typeof channels)[number] = "r", bestRange = -1;
  for (const channel of channels) {
    let min = 255, max = 0;
    for (const entry of box) {
      if (entry[channel] < min) min = entry[channel];
      if (entry[channel] > max) max = entry[channel];
    }
    if (max - min > bestRange) {
      bestRange = max - min;
      best = channel;
    }
  }
  return { channel: best, range: bestRange };
}

function splitBox(box: Box): [Box, Box] {
  const { channel } = widestChannel(box);
  const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
  const total = sorted.reduce((sum, entry) => sum + entry.count, 0);
  let running = 0, cut = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    running += sorted[i].count;
    if (running >= total / 2) {
      cut = i + 1;
      break;
    }
    cut = i + 1;
  }
  return [sorted.slice(0, cut), sorted.slice(cut)];
}

function meanColor(box: Box): [number, number, number] {
  const total = box.reduce((sum, entry) => sum + entry.count, 0);
  const mean = (channel: "r" | "g" | "b") => Math.round(box.reduce((sum, entry) => sum + entry[channel] * entry.count, 0) / total);
  return [mean("r"), mean("g"), mean("b")];
}

/** Returns a flat [r,g,b,...] palette of at most maxColors entries. */
export function medianCutPalette(counts: Map<number, number>, maxColors: number): number[] {
  let boxes: Box[] = [[...counts].map(([key, count]) => ({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count }))];
  while (boxes.length < maxColors) {
    let target = -1, widest = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { range } = widestChannel(box);
      if (range > widest) {
        widest = range;
        target = i;
      }
    });
    if (target < 0) break;
    const [a, b] = splitBox(boxes[target]);
    boxes = [...boxes.slice(0, target), a, b, ...boxes.slice(target + 1)];
  }
  return boxes.flatMap(meanColor);
}

/** Index of the palette entry nearest to a colour (squared RGB distance). */
export function nearestIndex(palette: number[], r: number, g: number, b: number) {
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 3) {
    const distance = (palette[i] - r) ** 2 + (palette[i + 1] - g) ** 2 + (palette[i + 2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i / 3;
    }
  }
  return best;
}
