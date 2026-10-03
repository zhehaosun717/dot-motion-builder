# Dot Matrix Studio

**简体中文** | [English](./README.en.md)

给 **iDotMatrix 32×32 蓝牙 LED 点阵屏** 用的 Windows 桌面应用：不用厂商 App，直接在电脑上画像素动画、实时同步到屏幕、把屏幕当副屏投屏，还能让 AI agent 通过 MCP 在屏上显示自己的工作状态和心情。

**下载：** [最新版安装包](https://github.com/zhehaosun717/dot-motion-builder/releases/latest)（`Dot.Matrix.Studio.Setup.x.y.z.exe`）

## 能做什么

### 控制点阵屏

- **自动连接**：应用常驻系统托盘，启动后自动找到并连接 `IDM-` 开头的点阵屏，掉线自动重连，关闭窗口也保持连接。
- **实时同步**：编辑器里画的每一笔、播放的每一段动画都立刻出现在屏上。帧按「真正亮起的那一刻」采样，实测像素画可达 40–50 帧/秒。
- **投屏**：选择一个屏幕或窗口，缩放到 32×32 实时显示，针对 LED 做了颜色校正。
- **存到屏幕**：把动画编码成循环 GIF 写入点阵屏的板载内存，断开电脑后屏幕继续播放。
- **点阵屏色彩**：亮度、对比度、饱和度、伽马、色温五个滑块，只校正发到屏上的画面（实时同步、投屏、存到屏幕），编辑器和导出文件不受影响。开着实时同步拖滑块，对照电脑屏幕调；设置会记住。
- **中文显示**：内置 10px 中文像素字体（GB2312 全部简体字和常用繁体字），一屏可显示 3 行 × 3 字，更长的文字自动滚动。

### 像素动画编辑器

- 网格从 3×3 到 32×32；32×32 时一个格子就是屏上的一颗 LED。小网格放大显示时默认铺满整屏、不留缝，也可以选「格子间留缝」做出点阵效果。
- 绘制工具：**画笔 (B)**、**橡皮 (E)**、**油漆桶填充 (G)**、**吸管 (I)**，形状 **直线 (L)**、**矩形 (R)**、**圆 (O)**；矩形和圆可选实心或空心，拖动时按住 Shift 临时切换。快速拖动也不会断笔。
- **撤销 / 重做**：Ctrl+Z、Ctrl+Y（或 Ctrl+Shift+Z），最多 100 步；一笔、一次填充、一次拖动滑块都算一步。
- **多色像素画**：每个格子可以有自己的颜色。选好「画笔颜色」作画，最近用过的颜色会排成色板；吸管或 Alt+点击格子可吸取颜色。油漆桶默认只填充颜色相同的相连区域，调高「填充容差」可以一次填满照片里相近的颜色，关掉「只填相连区域」就是全图替换同一种颜色。
- **整体移动**：方向键或按钮把整幅画平移一格，还能水平 / 垂直翻转、顺时针 / 逆时针旋转 90°。
- **文字**：用内置像素字体把文字写到画面中间（10px 中文字体或 3×5 小字），支持换行，写完可以用方向键挪位置。
- **导入图片和动图**：图片按当前网格缩放（32×32 时一格一像素），可选「完整显示」或「铺满裁切」；「暗部截断」决定多暗的像素保持熄灭，还可以减到 32 / 16 / 8 / 4 / 2 种颜色并加抖动。导入后这些选项实时重新套用，边调边看。GIF / 动态 WebP 会变成序列帧（最多 24 帧，保持原来的播放速度）。
- **图库**：把当前画面（连同每格颜色）存起来，之后点缩略图就能载入到任意画板。
- 12 种动效预设（波浪、扫描、雷达、呼吸、心跳……）和逐帧序列动画；可调颜色、透明度、形状、发光。
- 32×32 大网格用 canvas 绘制，编辑和预览都很流畅。

### 让 AI agent 用屏幕表达状态

应用自带一个 MCP 服务器，任何支持 MCP 的 agent 都能使用：

| 工具 | 作用 |
|---|---|
| `set_status` | 工作状态图标：空闲、思考中、工作中、等你确认、完成、出错，可带中英文短标签 |
| `set_mood` | 动画像素表情：平静、开心、兴奋、喜爱、得意、惊讶、困惑、难过、生气、困倦、紧张 |
| `show_text` | 显示一段文字（支持中文） |
| `draw_pixels` | 用调色板网格画 32×32 像素画，可做成动画 |
| `get_panel_state` | 查询点阵屏是否已连接、正在显示什么 |

另有一个 hook 命令行，可以在 agent 的生命周期事件里自动切换状态（例如：你发消息 → 思考中；需要你确认 → 等待中；回答结束 → 完成）。agent 主动设置的心情会保留 12 秒，不会被 hook 立刻覆盖。

## 安装与使用

1. 从 [Releases](https://github.com/zhehaosun717/dot-motion-builder/releases/latest) 下载安装包并运行。安装包没有代码签名，Windows SmartScreen 可能提示，选「更多信息 → 仍要运行」。
2. **先断开手机上的 iDotMatrix App**：点阵屏同一时间只接受一个蓝牙连接。
3. 打开 Dot Matrix Studio，它会自动连接点阵屏。顶栏按钮：
   - **Agent 显示**：允许 AI agent 控制屏幕；
   - **实时同步** / **投屏**：编辑器画面或屏幕画面实时上屏；
   - **存到屏幕**：把当前动画存进点阵屏；
   - **断开**。
4. 关闭窗口后应用留在托盘里；托盘菜单可以设置开机自启、手动连接、退出。

## 接入 AI agent

安装并运行过一次应用后，MCP 服务器和 hook 命令行会被放到 `%APPDATA%\Dot Matrix Studio\mcp\`（需要 Node.js）。

MCP 客户端配置（stdio）：

```json
{
  "command": "node",
  "args": ["C:\\Users\\<你>\\AppData\\Roaming\\Dot Matrix Studio\\mcp\\server.cjs"]
}
```

应用没在运行时，第一次调用工具会自动把它启动起来。

Hook 命令行示例（适合在 agent 的生命周期 hook 里调用；它总在约 1.5 秒内以 0 退出，不会启动应用）：

```bash
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" status thinking --hook
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" status done 部署 --hook
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" mood happy
node "%APPDATA%\Dot Matrix Studio\mcp\cli.cjs" text "构建通过"
```

## 工作原理

- **蓝牙**：编辑器用 Web Bluetooth 直接和点阵屏通信。存到屏幕走 GIF 上传：每 4 KiB 一块，块头 16 字节，逐块等待屏幕确认。实时画面走 DIY 模式下的单帧 RGB PNG，最多一帧在途，包与包之间间隔 18ms，确认丢失时自动加大间隔。协议参考了 DeskDot 项目的硬件实测记录，并在 `IDM-0384DA` 上实测验证。
- **渲染**：编辑器的动效采样器渲染出 32×32 帧，按 LED 的线性亮度做伽马校正。GIF 编码器为所有帧共用一套调色板，避免颜色闪烁。
- **桌面应用**：Electron 把静态导出的编辑器跑在 `127.0.0.1` 上，独占蓝牙连接。本机 API（默认端口 47321）用随机令牌保护，令牌保存在 `%APPDATA%\Dot Matrix Studio\agent-api.json`，并检查请求的 Host，网页无法冒充 agent 控制屏幕。

## 开发

需要 Node.js 20+ 和 pnpm 11+。

```bash
pnpm install
pnpm dev              # 网页版编辑器，http://127.0.0.1:3000/editor（Chrome/Edge 里也能用 Web Bluetooth）
pnpm start:fast       # 生产构建的网页版（4321 端口），32×32 网格下快很多
pnpm desktop:start    # 构建并运行桌面应用
pnpm desktop:dist     # 生成 Windows 安装包到 release/
pnpm test             # 类型检查 + 全部测试
```

测试覆盖：动效采样、代码导出、GIF/PNG 编码与蓝牙分包、实时推流（重试、迟到确认、互斥、冷却）、表情与中文渲染、本机 API 安全检查、MCP 工具端到端调用、绘图工具几何计算。

## 项目结构

```text
src/
  components/editor/           画布、属性面板、绘图工具、iDotMatrix 面板、实时同步
  lib/idotmatrix/              32x32 渲染、GIF/PNG 编码、蓝牙协议与连接、投屏
  lib/agent-display/           表情、状态图标、像素字体（含中文）、场景
  lib/core/  lib/exporters/    动效采样器与 Web/SwiftUI 代码导出（来自原编辑器）
  stores/                      编辑器与点阵屏状态
desktop/src/                   Electron 主进程：托盘、自动连接、本机 agent API、投屏选择
mcp/src/                       MCP 服务器与 hook 命令行
scripts/                       测试、桌面构建、字体数据生成
```

## 致谢与许可

- 编辑器部分基于 [LerSent001/dot-motion-builder](https://github.com/LerSent001/dot-motion-builder)（MIT）开发；原项目的 Web/SwiftUI 代码导出功能仍然保留，说明见 [README.en.md](./README.en.md#editor-code-export)。
- Toolcraft UI 源码保留 Pixel Point 的 MIT 声明，见 [TOOLCRAFT_LICENSE.md](./TOOLCRAFT_LICENSE.md)。
- 中文像素字体数据来自 TakWolf 的 [缝合像素字体 Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（SIL OFL 1.1），许可全文见 [src/lib/agent-display/FONT-LICENSE.txt](./src/lib/agent-display/FONT-LICENSE.txt)。
- 蓝牙协议参考 [8none1/idotmatrix](https://github.com/8none1/idotmatrix)、[derkalle4/python3-idotmatrix-client](https://github.com/derkalle4/python3-idotmatrix-client)、[markusressel/idotmatrix-api-client](https://github.com/markusressel/idotmatrix-api-client) 和 [DeskDot](https://github.com/shivpatel2468/idotmatrix) 的逆向与实测记录。
- iDotMatrix 是其各自所有者的商标，本项目与其无关联。
