/**
 * Colour correction for what goes to the LED panel only (the editor and file exports stay untouched).
 * A raw LED drives sRGB values linearly, so photos look washed out and colder than on a monitor;
 * these knobs let you match the panel to the screen by eye.
 */
export type PanelTuning = {
  /** Overall drive level, percent (100 = unchanged). */
  brightness: number;
  /** Spread around mid grey, percent (100 = unchanged). */
  contrast: number;
  /** Colourfulness, percent (0 = grey, 100 = unchanged). */
  saturation: number;
  /** Midtone curve exponent (1 = raw; ~2.2 linearises sRGB for LEDs, darkening midtones). */
  gamma: number;
  /** White balance, -100 (cooler) .. 100 (warmer); 0 = unchanged. */
  warmth: number;
  /**
   * Lowest drive level the panel shows (0 = off). LEDs stay dark below roughly 36 of 255, so fades and dim
   * colours would vanish; lit pixels are remapped into floor..255 instead.
   */
  floor: number;
  /** Per-channel drive, percent (100 = unchanged): fine white balance when one LED colour runs strong. */
  redGain: number;
  greenGain: number;
  blueGain: number;
};

export type PanelTuningKey = keyof PanelTuning;

/** neutral changes nothing; initial is what a panel starts with (and what Reset returns to). */
export const PANEL_TUNING_RANGES: Record<PanelTuningKey, { min: number; max: number; step: number; neutral: number; initial: number }> = {
  brightness: { min: 10, max: 200, step: 5, neutral: 100, initial: 100 },
  contrast: { min: 50, max: 200, step: 5, neutral: 100, initial: 100 },
  saturation: { min: 0, max: 200, step: 5, neutral: 100, initial: 100 },
  gamma: { min: 0.5, max: 3, step: 0.1, neutral: 1, initial: 1 },
  warmth: { min: -100, max: 100, step: 5, neutral: 0, initial: 0 },
  // Measured on an IDM-0384DA 32x32: red, green, blue and white all start to light between 32 and 40.
  floor: { min: 0, max: 80, step: 2, neutral: 0, initial: 36 },
  redGain: { min: 20, max: 150, step: 1, neutral: 100, initial: 100 },
  greenGain: { min: 20, max: 150, step: 1, neutral: 100, initial: 100 },
  blueGain: { min: 20, max: 150, step: 1, neutral: 100, initial: 100 }
};

export const PANEL_TUNING_KEYS = Object.keys(PANEL_TUNING_RANGES) as PanelTuningKey[];

const tuningFrom = (pick: "neutral" | "initial") =>
  Object.fromEntries(PANEL_TUNING_KEYS.map((key) => [key, PANEL_TUNING_RANGES[key][pick]])) as PanelTuning;

/** Changes nothing. */
export const NEUTRAL_PANEL_TUNING: PanelTuning = tuningFrom("neutral");
/** Where a panel starts: unchanged colours with the measured dark floor. */
export const DEFAULT_PANEL_TUNING: PanelTuning = tuningFrom("initial");

/** Below this (of 255) a pixel is rounding noise from a fade's tail and stays off rather than being lifted. */
const FLOOR_NOISE = 3;
/** A channel that would land under half the floor is dropped: lifting it would tint the colour. */
const FLOOR_DROP = 0.5;

/** Strongest channel cut at warmth ±100: warm dims blue (and some green), cool dims red. */
const WARMTH_BLUE = 0.3;
const WARMTH_GREEN = 0.12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function isNeutralTuning(tuning: PanelTuning): boolean {
  return PANEL_TUNING_KEYS.every((key) => tuning[key] === PANEL_TUNING_RANGES[key].neutral);
}

/** Accepts stored or partial input; anything missing or out of range falls back or is clamped. */
export function sanitizePanelTuning(value: unknown): PanelTuning {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const entries = PANEL_TUNING_KEYS.map((key) => {
    const { min, max, initial } = PANEL_TUNING_RANGES[key];
    const raw = source[key];
    // Rounded so slider steps like 0.1 do not leave 1.2000000000000002 behind.
    return [key, typeof raw === "number" && Number.isFinite(raw) ? Number(clamp(raw, min, max).toFixed(2)) : initial] as const;
  });
  return Object.fromEntries(entries) as PanelTuning;
}

function whiteBalanceGains(warmth: number): [number, number, number] {
  const amount = clamp(warmth, -100, 100) / 100;
  if (amount >= 0) return [1, 1 - WARMTH_GREEN * amount, 1 - WARMTH_BLUE * amount];
  return [1 + WARMTH_BLUE * amount, 1 + WARMTH_GREEN * amount, 1];
}

/**
 * Returns a corrected copy of a packed RGB frame (or the same array when the tuning is neutral).
 * Pure black stays black: an unlit LED must not start glowing because contrast or warmth moved.
 */
export function applyPanelTuning(rgb: Uint8Array, tuning: PanelTuning): Uint8Array {
  if (isNeutralTuning(tuning)) return rgb;
  const saturation = tuning.saturation / 100;
  const contrast = tuning.contrast / 100;
  const brightness = tuning.brightness / 100;
  const warmthGains = whiteBalanceGains(tuning.warmth);
  const channelGains = [tuning.redGain, tuning.greenGain, tuning.blueGain];
  const gains = warmthGains.map((gain, c) => (gain * channelGains[c]) / 100);
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const [r, g, b] = [rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255];
    if (r === 0 && g === 0 && b === 0) continue;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    [r, g, b].forEach((channel, c) => {
      const saturated = luma + (channel - luma) * saturation;
      const contrasted = (saturated - 0.5) * contrast + 0.5;
      const lit = clamp(contrasted * brightness, 0, 1) ** tuning.gamma;
      out[i + c] = Math.round(clamp(lit * gains[c], 0, 1) * 255);
    });
  }
  return tuning.floor > 0 ? liftToFloor(out, tuning.floor) : out;
}

/**
 * Remaps each lit pixel's brightness (its strongest channel) from 0..255 to floor..255 and scales the other
 * channels by the same factor, so the colour keeps its hue. A channel that would still sit below the floor is
 * raised to it, or dropped when it is under half the floor (it would only tint the colour).
 */
function liftToFloor(rgb: Uint8Array, floor: number): Uint8Array {
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const peak = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
    if (peak < FLOOR_NOISE) continue;
    const scale = (floor + ((255 - floor) * peak) / 255) / peak;
    for (let c = 0; c < 3; c++) {
      const lifted = rgb[i + c] * scale;
      out[i + c] = lifted < floor * FLOOR_DROP ? 0 : Math.round(Math.max(lifted, floor));
    }
  }
  return out;
}
