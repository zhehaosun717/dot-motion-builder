export const STATUSES = ["idle", "thinking", "working", "waiting", "done", "error"] as const;
export type Status = (typeof STATUSES)[number];
