/** iDotMatrix 32x32 panel limits. Values marked "hardware" were measured by the DeskDot project on real panels. */
export const MATRIX_SIZE = 32;

/** Panel stores and loops a GIF itself; GIFs above ~40 KB decode sluggishly (hardware). */
export const GIF_BUDGET_BYTES = 40 * 1024;
export const MAX_GIF_FRAMES = 120;
export const MAX_GIF_FPS = 20;

export const SERVICE_UUID = "000000fa-0000-1000-8000-00805f9b34fb";
export const WRITE_UUID = "0000fa02-0000-1000-8000-00805f9b34fb";
export const NOTIFY_UUID = "0000fa03-0000-1000-8000-00805f9b34fb";
export const DEVICE_NAME_PREFIX = "IDM-";

/** Bulk uploads are framed per 4 KiB chunk; the panel acks each chunk on the notify characteristic. */
export const UPLOAD_CHUNK_BYTES = 4096;
