# Dot Motion Builder

**English** | [简体中文](./README.zh-CN.md)

Dot Motion Builder is a local-first visual editor for designing dot-matrix loading animations and exporting production-ready Web and SwiftUI code.

**Live editor:** [dot-motion-builder.vercel.app](https://dot-motion-builder.vercel.app/editor)

It replaces hand-written timing logic and repeated parameter tuning with a direct-manipulation canvas: draw the active cells, choose a motion preset, tune the appearance, preview the result, and copy or download code for the target platform.

The editor runs entirely in the browser. It has no account system, backend API, database, or cloud dependency, and project data stays in the browser's `localStorage`.

## Highlights

- Pan-and-zoom canvas with multiple independent artboards.
- Bottom-center Focus Canvas control that recenters all artboards and fits oversized layouts into view.
- Custom loaders and frame-based sequence animations.
- Direct cell drawing, plus Fill Grid and Clear Grid actions.
- Square grids from 3×3 through 32×32 (32×32 maps one cell to one LED of a 32×32 panel).
- Six exposed cell shapes: Rounded, Square, Circle, Diamond, Hexagon, and Star.
- 12 mask-safe motion presets with direction- and origin-aware controls where applicable.
- Separate active-cell and inactive-cell animation styles.
- Active and inactive colors with opacity controls.
- Optional glow whose color follows the active color.
- Chinese and English editor UI.
- Sends animations to an iDotMatrix 32×32 Bluetooth LED panel: as a looping GIF, or live while you edit.
- Self-contained Web and SwiftUI exports only—no SVG, Lottie, PNG sequence, SVGA, or project-code clutter.
- Toolcraft-based inspector controls, sheets, selectors, switches, sliders, segmented controls, and color inputs.

## Motion presets

The current preset library includes Wave, Sweep, Fish-eye Lens, Burst, Bloom, Diamond, Radar, Random, Checkerboard, Heartbeat, Breathing, and Pinwheel.

Every preset is mask-safe: each selected cell visibly participates over a cycle even when the grid is sparse. Fill-dependent paths, scans, icons, letters, and state drawings are intentionally excluded because those effects become incomplete or invisible when users draw a custom mask. Pulse, Ripple, and Blink also remain excluded.

Presets use a shared deterministic sampler, so the editor preview, Web export, and SwiftUI export consume the same motion data instead of maintaining separate platform-specific preset implementations.

## Editor controls

The inspector is organized into five focused sections:

### Grid

- Grid size: 3×3 to 32×32
- Cell shape
- Cell gap: 0 to 20 px

### Preset

- Motion preset
- Fill Grid
- Clear Grid

The grid does not have to be filled. Any subset of cells can be active, and all available motion presets are validated against sparse masks.

### Animation

- Playback speed
- Active Cells: Opacity Only, Brightness Scale, Fish-eye Lens, Shrink Active, or Pop In/Out
- Inactive Cells: None (Static), Static Dim, Breathe, or Ghost Grid
- Direction controls for directional presets
- Origin X/Y controls for origin-based presets
- Sequence FPS

### Colors

- Active color and opacity
- Inactive color and opacity

### Effects

- Glow on/off
- Glow range

## Sequence animation

Sequence mode is intended for frame-based icons, state transitions, progress changes, and custom loading cycles.

- New sequences default to 6 FPS.
- New frames copy the previous frame as an editing starting point.
- Frames remain editable side by side and collapse into one animated preview during playback.
- Active cells switch discretely by frame.
- Inactive-cell effects continue animating between sequence frames.
- Changing FPS updates the entire sequence.

## Export targets

Only two production targets are exposed: Web and SwiftUI.

Both exporters preserve the grid, active-cell mask, sequence order, shape, gap, color, opacity, glow, playback speed, and sampled motion. The generated output has a transparent outer background and does not include any editor UI.

### Web

The Web export is a single, dependency-free JavaScript file that registers a reusable Web Component. It performs no network requests and does not include a demo document or editor markup.

Load the generated file and add the component to the page:

```html
<script src="./loader-1.js" defer></script>
<dot-motion-loader style="width: 48px" speed="1"></dot-motion-loader>
```

The component defaults to 48 px wide. Resize it with CSS; height follows the exported aspect ratio automatically.

```css
dot-motion-loader {
  width: 24px;
}
```

Runtime controls:

```js
const loader = document.querySelector("dot-motion-loader");

loader.pause();
loader.play();
loader.seek(0.5);
loader.setAttribute("speed", "1.5");
```

Add the `paused` attribute to start in a paused state. Multiple instances keep independent playback state. When loading more than one different exported animation on the same page, give each script a unique `data-dot-motion-tag` value and use that custom-element name in the markup.

### SwiftUI

The SwiftUI export is a standalone `DotMotionView.swift` file with no third-party dependency. It supports iOS 15+ and macOS 12+.

The recommended default presentation size is 48×48 pt:

```swift
DotMotionView(isPlaying: true, speed: 1)
    .frame(width: 48, height: 48)
```

Use any other frame size when the surrounding interface requires it:

```swift
DotMotionView(isPlaying: isLoading, speed: 1.25)
    .frame(width: 24, height: 24)
```

If an app imports multiple independently exported files, rename each generated `DotMotionView` type to avoid a symbol collision.

## Typical sizes

The default 48 px / 48 pt size works well for centered page-level loading states. Common alternatives are:

- 20–24: buttons and compact inline feedback
- 32–40: forms, cards, and local loading states
- 48–64: page or panel loading states
- 80–120: large status displays

All geometry scales proportionally.

## Cross-platform validation

The current exporters have been validated in Chromium and in a native SwiftUI test app on an iPhone 17 Pro / iOS 26.4 Simulator.

- Web output renders offline, resizes correctly, and supports pause, play, seek, speed changes, multiple instances, sequences, and non-looping playback.
- SwiftUI output compiles as an arm64 Simulator app and renders in paused and animated states.
- A 6 FPS sequence changes frames at the expected interval while its inactive-cell animation remains continuous.
- Foreground geometry overlap between the two renderers measured 96.97% for the Fish-eye Lens fixture and 98.56% for a sequence fixture.

Web Canvas and SwiftUI Canvas do not produce mathematically identical edge pixels. Their blur kernels, color compositing, and polygon antialiasing create small differences around glow and diagonal edges, but no supported setting or animation effect is omitted.

See [PLATFORM-RENDER-QA.md](./PLATFORM-RENDER-QA.md) for the test matrix and measured results.

## Local-first data model

- Projects are saved to browser `localStorage`.
- Nothing is uploaded by the application.
- Clearing site data removes locally saved projects.
- Cloud sync, accounts, collaboration, and version history are not currently included.

## LED panel (iDotMatrix 32×32)

The editor can drive an iDotMatrix 32×32 Bluetooth LED panel directly from desktop Chrome or Edge (Web Bluetooth); no vendor app is needed. Close the phone app first: the panel accepts one connection at a time.

- **Export → iDotMatrix** renders the selected loader to 32×32 frames, encodes a looping GIF (shared palette, ≤ 40 KB) and uploads it with per-chunk acknowledgements. The panel keeps playing it after you disconnect.
- **Live Sync** (top bar) streams every edit and the preview animation as single frames. Frames are sampled at the moment they will light up, so motion keeps real-time pace at whatever rate the link sustains (measured 40–50 fps for pixel-art frames).
- **Mirror Screen** shows a screen, window or tab, letterboxed and colour-corrected for the LEDs.

The protocol follows the hardware notes of the DeskDot project: GIFs go in 4 KiB chunks with a 16-byte header; live frames are PNGs in the panel's DIY mode. Live frames start with no inter-packet gap and back off automatically if the panel stops acknowledging.

## Desktop app and agent display

`pnpm desktop:dist` builds **Dot Matrix Studio**, a Windows app (`release/Dot Matrix Studio Setup <version>.exe`). It wraps the editor, sits in the tray, connects to the panel by itself and keeps the link while the window is closed.

It also lets AI agents show what they are doing on the panel:

- **MCP server** (`%APPDATA%\Dot Matrix Studio\mcp\server.cjs`, run with `node`) with five tools: `set_status` (idle, thinking, working, waiting, done, error, optional label), `set_mood` (an animated pixel face: neutral, happy, excited, love, proud, surprised, confused, sad, angry, sleepy, nervous), `show_text`, `draw_pixels` (palette grids, optionally animated) and `get_panel_state`. It starts the app if it is not running.
- **Hook CLI** (`mcp\cli.cjs`) for agent lifecycle hooks, e.g. `node cli.cjs status thinking --hook` on prompt submit and `status done --hook` when a turn ends. It always exits 0 within ~1.5 s and never starts the app. A mood an agent chose stays up for 12 s before hook updates may replace it; "thinking" and "waiting" always show.
- Both talk to a local API on `127.0.0.1` (default port 47321) protected by a random token in `%APPDATA%\Dot Matrix Studio\agent-api.json`; requests must target a local Host and carry the token header, so web pages cannot drive the panel.

Example MCP client entry: `{"command": "node", "args": ["%APPDATA%\\Dot Matrix Studio\\mcp\\server.cjs"]}`.

Scripts: `pnpm desktop:start` (build and run), `pnpm desktop:dist` (installer), `pnpm start:fast` (production web build on port 4321; much faster than `pnpm dev` on 32×32 grids).

## Development

Requirements:

- Node.js 20+
- pnpm 11+

Install and start the development server:

```bash
pnpm install
pnpm dev
```

Open:

```text
http://127.0.0.1:3000/editor
```

Create a production build:

```bash
pnpm build
pnpm start --hostname 127.0.0.1 --port 3000
```

## Verification

Run the type, motion, and exporter checks:

```bash
pnpm test
```

Individual checks:

```bash
pnpm typecheck
pnpm test:motion
pnpm test:exports
pnpm test:idotmatrix   # GIF/BLE framing, live streaming
pnpm test:agent        # agent display, desktop API, MCP tools
```

Browser-level checks live in `scripts/` and use Playwright. `scripts/platform-web-qa.mjs` validates real rendered pixels, clipping, continuous motion, and the 6 FPS sequence timeline.

## Project structure

```text
src/
  app/                         Next.js routes and global styling
  components/editor/           Canvas, inspector, preview, and export UI
  lib/core/                    Shared motion sampling and timelines
  lib/exporters/               Web and SwiftUI generators
  lib/idotmatrix/              LED panel: 32x32 rendering, GIF/PNG encoding, BLE protocol and link
  lib/agent-display/           Agent moods, status icons, pixel font and scenes
  stores/                      Zustand editor state and persistence
  toolcraft/                   Toolcraft UI source used by the editor
  types/                       Core project and animation types
desktop/src/                   Electron main process, local agent API, tray
mcp/src/                       MCP server and hook CLI
scripts/                       Motion, export, panel, desktop and MCP tests; desktop build
```

## Deployment

The application has no required server-side service, database, account system, or environment variable. Vercel can deploy it directly from this repository with the standard Next.js settings.

For a conventional production build:

```bash
pnpm install --frozen-lockfile
pnpm build
```

## Credits and third-party license

The editor includes Toolcraft UI source used by the Orb project for its inspector and control system. The included Toolcraft code retains Pixel Point's MIT notice; see [TOOLCRAFT_LICENSE.md](./TOOLCRAFT_LICENSE.md).
