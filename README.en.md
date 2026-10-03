# Dot Matrix Studio

[简体中文](./README.md) | **English**

A Windows desktop app for the **iDotMatrix 32×32 Bluetooth LED panel**. No vendor app needed: draw pixel animations on your computer, stream them live to the panel, mirror a screen onto it, and let AI agents show their work status and mood on it through MCP.

**Download:** [latest installer](https://github.com/zhehaosun717/dot-motion-builder/releases/latest) (`Dot.Matrix.Studio.Setup.x.y.z.exe`)

## What it does

### Panel control

- **Auto-connect**: lives in the tray, finds and connects the `IDM-…` panel on start, reconnects when the link drops, and keeps the link while the window is closed.
- **Live Sync**: every stroke and every preview animation shows on the panel immediately. Frames are sampled for the moment they light up; pixel-art frames stream at 40–50 fps.
- **Mirror Screen**: pick a screen or window; it is scaled to 32×32 and colour-corrected for the LEDs.
- **Save to Panel**: encodes the animation as a looping GIF in the panel's own memory, so it keeps playing after you disconnect.
- **Chinese text**: a built-in 10px pixel font (all GB2312 simplified hanzi plus common traditional ones) fits 3 lines × 3 characters; longer text scrolls.

### Pixel animation editor

- Grids from 3×3 to 32×32; at 32×32 one cell is one LED. Smaller grids scale up to fill the panel edge to edge, or with optional gaps for a dot-matrix look.
- Drawing tools: **Brush (B)**, **Erase (E)**, **Rectangle (R)**, **Bucket fill (G)**. Fast strokes stay continuous.
- 12 motion presets (wave, sweep, radar, breathing, heartbeat, …) and frame sequences; colour, opacity, shape and glow controls.
- Grids above 13×13 render on a canvas, so 32×32 editing and preview stay smooth.

### Let AI agents show their state

The app ships an MCP server that any MCP-capable agent can use:

| Tool | What it shows |
|---|---|
| `set_status` | Work status icon: idle, thinking, working, waiting (needs you), done, error; optional short label (English or Chinese) |
| `set_mood` | Animated pixel face: neutral, happy, excited, love, proud, surprised, confused, sad, angry, sleepy, nervous |
| `show_text` | A short message (Chinese supported) |
| `draw_pixels` | 32×32 pixel art from a palette grid, optionally animated |
| `get_panel_state` | Whether the panel is connected and what it shows |

A hook CLI switches status automatically from agent lifecycle hooks (e.g. prompt submitted → thinking, needs approval → waiting, turn finished → done). A mood the agent chose is held for 12 s before hook updates may replace it.

## Install and use

1. Download the installer from [Releases](https://github.com/zhehaosun717/dot-motion-builder/releases/latest) and run it. It is unsigned, so Windows SmartScreen may ask: choose "More info → Run anyway".
2. **Disconnect the iDotMatrix phone app first**: the panel accepts one Bluetooth connection at a time.
3. Open Dot Matrix Studio; it connects to the panel by itself. Top bar:
   - **Agent Display**: let AI agents drive the panel;
   - **Live Sync** / **Mirror Screen**: put the editor or a screen on the panel live;
   - **Save to Panel**: store the current animation on the panel;
   - **Disconnect**.
4. Closing the window keeps the app in the tray; the tray menu has start-at-login, connect and quit.

## Connect an AI agent

After the app has run once, the MCP server and hook CLI live in `%APPDATA%\Dot Matrix Studio\mcp\` (requires Node.js).

MCP client entry (stdio):

```json
{
  "command": "node",
  "args": ["C:\\Users\\<you>\\AppData\\Roaming\\Dot Matrix Studio\\mcp\\server.cjs"]
}
```

If the app is not running, the first tool call starts it.

Hook CLI examples (for agent lifecycle hooks; always exits 0 within ~1.5 s and never starts the app):

```bash
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" status thinking --hook
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" status done deploy --hook
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" mood happy
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" text "构建通过"
```

## How it works

- **Bluetooth**: the editor talks to the panel over Web Bluetooth. Saving to the panel uploads a GIF in 4 KiB chunks with a 16-byte header, waiting for each chunk's acknowledgement. Live frames are single PNGs in the panel's DIY mode, at most one in flight, sent without inter-packet gaps and backing off if acknowledgements go missing. The protocol follows the DeskDot project's hardware notes and was verified on an `IDM-0384DA` panel.
- **Rendering**: the editor's motion sampler renders 32×32 frames, gamma-corrected for linear LED brightness; GIFs use one palette across all frames so colours do not flicker.
- **Desktop app**: Electron serves the statically exported editor on `127.0.0.1` and owns the Bluetooth link. The local API (default port 47321) requires a random token stored in `%APPDATA%\Dot Matrix Studio\agent-api.json` and a local Host header, so web pages cannot pose as an agent.

## Development

Requires Node.js 20+ and pnpm 11+.

```bash
pnpm install
pnpm dev              # web editor at http://127.0.0.1:3000/editor (Web Bluetooth works in Chrome/Edge too)
pnpm start:fast       # production web build on port 4321, much faster on 32×32 grids
pnpm desktop:start    # build and run the desktop app
pnpm desktop:dist     # Windows installer in release/
pnpm test             # typecheck and all test suites
```

Tests cover motion sampling, code export, GIF/PNG encoding and Bluetooth framing, live streaming (retries, late acks, mutual exclusion, cooldown), faces and Chinese text rendering, local API security checks, MCP tools end to end, and drawing-tool geometry.

## Editor code export

The editor still exports self-contained code for each animation. The **Web** export is one dependency-free JavaScript file registering a `<dot-motion-loader>` Web Component (`pause()`, `play()`, `seek()`, `speed` attribute). The **SwiftUI** export is a standalone `DotMotionView.swift` for iOS 15+ / macOS 12+. Both keep the grid, mask, sequence order, shape, colours, glow, speed and sampled motion.

## Project structure

```text
src/
  components/editor/           canvas, inspector, drawing tools, iDotMatrix panel, live sync
  lib/idotmatrix/              32x32 rendering, GIF/PNG encoding, Bluetooth protocol and link, mirroring
  lib/agent-display/           faces, status icons, pixel fonts (incl. Chinese), scenes
  lib/core/  lib/exporters/    motion sampler and Web/SwiftUI export (from the original editor)
  stores/                      editor and panel state
desktop/src/                   Electron main process: tray, auto-connect, local agent API, screen picker
mcp/src/                       MCP server and hook CLI
scripts/                       tests, desktop build, font data generation
```

## Credits and licenses

- The editor is based on [LerSent001/dot-motion-builder](https://github.com/LerSent001/dot-motion-builder) (MIT).
- Toolcraft UI source keeps Pixel Point's MIT notice; see [TOOLCRAFT_LICENSE.md](./TOOLCRAFT_LICENSE.md).
- Chinese pixel glyphs come from TakWolf's [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) (SIL OFL 1.1); full license in [src/lib/agent-display/FONT-LICENSE.txt](./src/lib/agent-display/FONT-LICENSE.txt).
- Bluetooth protocol knowledge from [8none1/idotmatrix](https://github.com/8none1/idotmatrix), [derkalle4/python3-idotmatrix-client](https://github.com/derkalle4/python3-idotmatrix-client), [markusressel/idotmatrix-api-client](https://github.com/markusressel/idotmatrix-api-client) and [DeskDot](https://github.com/shivpatel2468/idotmatrix).
- iDotMatrix is a trademark of its respective owner; this project is not affiliated with it.
