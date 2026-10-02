import { EditorApp } from "@/components/editor/editor-app";

// The editor is fully client-rendered; caching is controlled by headers() in next.config.mjs, so the
// page can be prerendered and statically exported for the desktop app.
export default function EditorPage() {
  return <EditorApp />;
}
