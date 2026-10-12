/**
 * Measured colour response of the iDotMatrix 32x32 panel, and the conversion that makes it show sRGB colours
 * the way a monitor does. Measured 2026-10-12 on an IDM-0384DA with a SpyderX and ArgyllCMS spotread
 * (full-panel patches, dark room): every channel is close to linear from level 8 up, but the white point is
 * far too blue (xy 0.230, 0.197) and the green primary leans cyan, so raw sRGB values look pale and pinkish.
 */

/** XYZ of each primary at full drive (black subtracted), and its relative luminance at measured drive levels. */
export const PANEL_PROFILE = {
  device: "IDM-0384DA",
  primaries: {
    red: [26.385, 11.376, 0.007],
    green: [7.838, 33.827, 11.095],
    blue: [26.961, 8.33, 149.266]
  },
  levels: [0, 8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192, 224, 255],
  response: {
    red: [0, 0.0349, 0.07, 0.1074, 0.142, 0.1774, 0.2129, 0.2851, 0.3576, 0.4248, 0.4971, 0.5657, 0.7069, 0.8433, 0.9745, 1],
    green: [0, 0.031, 0.0627, 0.0937, 0.1255, 0.1573, 0.1883, 0.2511, 0.3146, 0.3752, 0.4401, 0.5008, 0.6263, 0.754, 0.8788, 1],
    blue: [0, 0.0307, 0.0617, 0.0928, 0.1264, 0.1574, 0.1885, 0.2501, 0.3148, 0.3765, 0.4412, 0.5033, 0.6295, 0.7563, 0.8857, 1]
  }
} as const;

type Matrix = readonly (readonly [number, number, number])[];

/** Linear sRGB (D65) to CIE XYZ. */
const SRGB_TO_XYZ: Matrix = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505]
];

const multiply = (m: Matrix, v: readonly number[]): [number, number, number] =>
  [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as [number, number, number];

function invert(m: Matrix): Matrix {
  const [[a, b, c], [d, e, f], [g, h, k]] = m;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  const rows: [number, number, number][] = [
    [e * k - f * h, c * h - b * k, b * f - c * e],
    [f * g - d * k, a * k - c * g, c * d - a * f],
    [d * h - e * g, b * g - a * h, a * e - b * d]
  ];
  return rows.map((row) => row.map((value) => value / det) as [number, number, number]);
}

function product(a: Matrix, b: Matrix): Matrix {
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]) as [number, number, number]);
}

const { red, green, blue } = PANEL_PROFILE.primaries;
/** Columns are the primaries: panel drive (linear, 0..1 per channel) to XYZ. */
const PANEL_TO_XYZ: Matrix = [0, 1, 2].map((i) => [red[i], green[i], blue[i]] as [number, number, number]);
const SRGB_TO_PANEL_RAW = product(invert(PANEL_TO_XYZ), SRGB_TO_XYZ);
/** Scale so sRGB white lands on D65 with the strongest channel at full drive (as bright as balanced white gets). */
const WHITE_SCALE = 1 / Math.max(...multiply(SRGB_TO_PANEL_RAW, [1, 1, 1]));
const SRGB_TO_PANEL: Matrix = SRGB_TO_PANEL_RAW.map((row) => row.map((value) => value * WHITE_SCALE) as [number, number, number]);

/** sRGB code value to linear light, as a table. */
const SRGB_LINEAR = Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** Drive level (0..255) that gives the wanted relative luminance, by inverting a measured response curve. */
function inverseResponse(curve: readonly number[]) {
  const { levels } = PANEL_PROFILE;
  return (target: number) => {
    if (target <= 0) return 0;
    if (target >= 1) return 255;
    let i = 1;
    while (i < curve.length - 1 && curve[i] < target) i++;
    const t = (target - curve[i - 1]) / (curve[i] - curve[i - 1]);
    return levels[i - 1] + t * (levels[i] - levels[i - 1]);
  };
}

const INVERSE = [inverseResponse(PANEL_PROFILE.response.red), inverseResponse(PANEL_PROFILE.response.green), inverseResponse(PANEL_PROFILE.response.blue)];

/**
 * Grey balance, per channel: [drive from the matrix, drive that makes that grey neutral], measured 2026-10-12 on a
 * grey ramp (48..255) shown through the matrix calibration. Greys came out slightly red-magenta (xy ~0.316, 0.324):
 * red needs ~3.5% less, green ~1.7% more, blue ~3% less, and red runs strong when all channels are near full.
 */
export const GREY_BALANCE: readonly (readonly (readonly [number, number])[])[] = [
  [[7, 6.4], [12, 11.2], [18, 17.3], [26, 25.3], [37, 35], [49, 47.1], [63, 60.6], [79, 76.2], [98, 94.8], [119, 114.6], [143, 138.6], [169, 163.7], [199, 191.6], [255, 205.2]],
  [[6, 6.3], [11, 11.3], [17, 17.3], [25, 25.3], [34, 34.9], [46, 46.8], [59, 60.1], [74, 75.4], [92, 93.6], [111, 112.9], [134, 136.1], [158, 160.4], [184, 187], [211, 221.5]],
  [[2, 1.8], [3, 3.1], [5, 4.8], [7, 7], [10, 9.7], [13, 13], [17, 16.7], [22, 20.9], [27, 26], [32, 31.4], [39, 37.7], [46, 44.5], [53, 51.8], [62, 61.4]]
];

/**
 * Applies one channel's grey-balance curve to a drive level: linear between measured points, proportional below the
 * first one, and from the last point straight up to 255 at 255.
 */
export function balanceGrey(channel: number, drive: number): number {
  const points = GREY_BALANCE[channel];
  const [firstIn, firstOut] = points[0];
  if (drive <= firstIn) return (drive * firstOut) / firstIn;
  for (let i = 1; i < points.length; i++) {
    const [inA, outA] = points[i - 1];
    const [inB, outB] = points[i];
    if (drive <= inB) return outA + ((drive - inA) * (outB - outA)) / (inB - inA);
  }
  const [lastIn, lastOut] = points[points.length - 1];
  return lastIn >= 255 ? lastOut : lastOut + ((drive - lastIn) * (255 - lastOut)) / (255 - lastIn);
}

/**
 * The panel drive that shows an sRGB colour as a monitor would: linearise, map onto the measured primaries with a
 * D65 white, clip what the panel cannot show, undo each channel's measured response, then balance greys.
 */
export function calibrateToPanel(r: number, g: number, b: number): [number, number, number] {
  const linear = multiply(SRGB_TO_PANEL, [SRGB_LINEAR[r], SRGB_LINEAR[g], SRGB_LINEAR[b]]);
  return linear.map((value, c) => Math.round(balanceGrey(c, INVERSE[c](Math.min(1, Math.max(0, value)))))) as [number, number, number];
}
