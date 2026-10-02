# Dot Motion Builder

[English](./README.md) | **简体中文**

Dot Motion Builder 是一个本地优先的可视化编辑器，用来设计点阵加载动画，并导出可直接用于生产环境的 Web 和 SwiftUI 代码。

**在线编辑器：** [dot-motion-builder.vercel.app](https://dot-motion-builder.vercel.app/editor)

它用可直接操作的画布，取代手写时序逻辑和反复调参：画出激活的格子、选一个动效预设、调整外观、预览效果，然后复制或下载目标平台的代码。

编辑器完全在浏览器里运行，没有账号系统、后端 API、数据库或云端依赖，项目数据只保存在浏览器的 `localStorage` 中。

## 亮点

- 可平移、缩放的画布，支持多个独立画板。
- 底部居中的「聚焦画布」按钮，可重新居中所有画板，并把超出视野的布局缩放到可见范围。
- 自定义加载动画和逐帧序列动画。
- 直接在格子上作画，另有「填满网格」和「清空网格」操作。
- 正方形网格从 3×3 到 32×32（32×32 时一个格子正好对应 32×32 点阵屏上的一颗 LED）。
- 六种格子形状：圆角、方形、圆形、菱形、六边形、星形。
- 12 种适配稀疏图案的动效预设，按需提供方向和原点控制。
- 激活格子与未激活格子可分别设置动画样式。
- 激活色和未激活色均可调透明度。
- 可选发光效果，发光颜色跟随激活色。
- 编辑器界面支持中文和英文。
- 可把动画发送到 iDotMatrix 32×32 蓝牙 LED 点阵屏：既可以存成循环 GIF，也可以边编辑边实时显示。
- 只导出自包含的 Web 和 SwiftUI 代码，不夹带 SVG、Lottie、PNG 序列、SVGA 或项目工程代码。
- 属性面板控件（抽屉、选择器、开关、滑块、分段控件、颜色输入）基于 Toolcraft。

## 动效预设

当前预设库包括：波浪（Wave）、扫描（Sweep）、鱼眼（Fish-eye Lens）、爆发（Burst）、绽放（Bloom）、菱形（Diamond）、雷达（Radar）、随机（Random）、棋盘（Checkerboard）、心跳（Heartbeat）、呼吸（Breathing）、风车（Pinwheel）。

所有预设都适配稀疏图案：即使网格画得很稀疏，每个被选中的格子在一个周期内都会明显参与动画。依赖填满网格的路径、扫描线、图标、字母和状态图案被刻意排除，因为用户自己画图案时，这类效果会残缺甚至看不见。脉冲（Pulse）、涟漪（Ripple）和闪烁（Blink）同样不包含在内。

所有预设共用一个确定性的采样器，所以编辑器预览、Web 导出和 SwiftUI 导出使用的是同一份运动数据，而不是各平台各自维护一套预设实现。

## 编辑器控件

属性面板分为五个部分：

### 网格

- 点阵数量：3×3 到 32×32
- 格子形状
- 格子间距：0 到 20 px

### 预设

- 动效预设
- 填满网格
- 清空网格

网格不必填满。任意一组格子都可以设为激活，所有动效预设都在稀疏图案上验证过。

### 动画

- 播放速度
- 激活格子：仅透明度、亮度缩放、鱼眼、收缩激活、弹入弹出
- 未激活格子：无（静态）、静态暗点、呼吸、幽灵网格
- 方向类预设的方向控制
- 原点类预设的原点 X/Y 控制
- 序列帧率（FPS）

### 颜色

- 激活色及透明度
- 未激活色及透明度

### 效果

- 发光开关
- 发光范围

## 序列动画

序列模式适合逐帧图标、状态切换、进度变化和自定义加载循环。

- 新序列默认 6 FPS。
- 新增的帧会复制上一帧，作为编辑起点。
- 编辑时各帧并排显示，播放时合并成一个动画预览。
- 激活格子按帧离散切换。
- 未激活格子的效果在帧与帧之间持续播放。
- 修改 FPS 会作用于整个序列。

## 导出目标

只提供两种生产目标：Web 和 SwiftUI。

两种导出都会保留网格、激活图案、序列顺序、形状、间距、颜色、透明度、发光、播放速度和采样后的运动数据。生成的代码外层背景透明，不包含任何编辑器界面。

### Web

Web 导出是一个无依赖的 JavaScript 文件，会注册一个可复用的 Web Component。它不发起任何网络请求，也不包含演示页面或编辑器标记。

加载生成的文件，然后在页面里使用组件：

```html
<script src="./loader-1.js" defer></script>
<dot-motion-loader style="width: 48px" speed="1"></dot-motion-loader>
```

组件默认宽 48 px。用 CSS 调整宽度，高度会按导出时的宽高比自动跟随。

```css
dot-motion-loader {
  width: 24px;
}
```

运行时控制：

```js
const loader = document.querySelector("dot-motion-loader");

loader.pause();
loader.play();
loader.seek(0.5);
loader.setAttribute("speed", "1.5");
```

加上 `paused` 属性可以让组件以暂停状态开始。多个实例的播放状态互不影响。同一页面要加载多个不同的导出动画时，给每个脚本设置不同的 `data-dot-motion-tag`，并在标记里使用对应的自定义元素名。

### SwiftUI

SwiftUI 导出是一个独立的 `DotMotionView.swift` 文件，没有第三方依赖，支持 iOS 15+ 和 macOS 12+。

推荐的默认显示尺寸是 48×48 pt：

```swift
DotMotionView(isPlaying: true, speed: 1)
    .frame(width: 48, height: 48)
```

界面需要时也可以用其他尺寸：

```swift
DotMotionView(isPlaying: isLoading, speed: 1.25)
    .frame(width: 24, height: 24)
```

如果一个应用引入了多个分别导出的文件，请给每个生成的 `DotMotionView` 类型改名，避免符号冲突。

## 常用尺寸

默认的 48 px / 48 pt 适合页面级居中的加载状态。常见的其他尺寸：

- 20–24：按钮和紧凑的行内反馈
- 32–40：表单、卡片和局部加载状态
- 48–64：页面或面板加载状态
- 80–120：大型状态展示

所有几何尺寸都按比例缩放。

## 跨平台验证

当前的导出器已在 Chromium 以及 iPhone 17 Pro / iOS 26.4 模拟器上的原生 SwiftUI 测试应用中验证过。

- Web 输出可离线渲染、能正确缩放，并支持暂停、播放、跳转、调速、多实例、序列和非循环播放。
- SwiftUI 输出能编译为 arm64 模拟器应用，在暂停和播放状态下都能正确渲染。
- 6 FPS 的序列按预期间隔切换帧，同时未激活格子的动画保持连续。
- 两个渲染器的前景几何重合度：鱼眼测试用例为 96.97%，序列测试用例为 98.56%。

Web Canvas 和 SwiftUI Canvas 的边缘像素在数学上并不完全一致。两者的模糊核、颜色合成和多边形抗锯齿不同，会在发光和斜边附近产生细微差异，但没有任何受支持的设置或动画效果被省略。

测试矩阵和实测结果见 [PLATFORM-RENDER-QA.md](./PLATFORM-RENDER-QA.md)。

## 本地优先的数据模型

- 项目保存在浏览器的 `localStorage` 中。
- 应用不会上传任何数据。
- 清除网站数据会删除本地保存的项目。
- 目前不包含云同步、账号、协作和版本历史。

## LED 点阵屏（iDotMatrix 32×32）

编辑器可以在桌面版 Chrome 或 Edge 中通过 Web Bluetooth 直接控制 iDotMatrix 32×32 蓝牙 LED 点阵屏，不需要厂商的 App。请先关闭手机 App：点阵屏同一时间只接受一个连接。

- **导出 → iDotMatrix**：把选中的动画渲染成 32×32 的帧，编码成循环 GIF（所有帧共用一套调色板，体积不超过 40 KB），按块上传并逐块等待屏幕确认。断开连接后屏幕会继续播放。
- **实时同步**（顶栏）：把每一次编辑和预览动画逐帧推送到屏上。每一帧都按它真正亮起的时刻采样，所以无论链路实际能跑多少帧，动作节奏都与真实时间一致（像素画画面实测 40–50 帧/秒）。
- **投屏**：把一个屏幕、窗口或标签页缩放到 32×32 显示，四周留黑边不裁切，并针对 LED 做了颜色校正。

协议参考了 DeskDot 项目的硬件实测记录：GIF 按 4 KiB 分块，每块带 16 字节的头；实时帧是点阵屏 DIY 模式下的 PNG 图片。实时帧默认不留包间隔，如果屏幕不再回确认，会自动加大间隔。

## 桌面应用与 AI agent 显示

运行 `pnpm desktop:dist` 会构建 **Dot Matrix Studio** Windows 应用（`release/Dot Matrix Studio Setup <版本号>.exe`）。它把编辑器打包成桌面程序，常驻系统托盘，启动后自动连接点阵屏，关闭窗口时也保持连接。

它还能让 AI agent 把自己正在做的事情显示在点阵屏上：

- **MCP 服务器**（`%APPDATA%\Dot Matrix Studio\mcp\server.cjs`，用 `node` 运行），提供五个工具：
  - `set_status`：工作状态图标（空闲、思考中、工作中、等待你确认、完成、出错），可带一个短标签；
  - `set_mood`：动画像素表情（平静、开心、兴奋、喜爱、得意、惊讶、困惑、难过、生气、困倦、紧张）；
  - `show_text`：显示短文字；
  - `draw_pixels`：用调色板网格画像素画，可做成动画；
  - `get_panel_state`：查询点阵屏状态。

  应用没有运行时，调用工具会自动启动它。
- **Hook 命令行**（`mcp\cli.cjs`）：给 agent 的生命周期 hook 用。例如在用户发消息时执行 `node cli.cjs status thinking --hook`，在一轮回答结束时执行 `status done --hook`。它总是在约 1.5 秒内以退出码 0 结束，并且不会启动应用。agent 主动设置的心情会保留 12 秒，之后才允许被 hook 的自动状态替换；「思考中」和「等待中」总是立即显示。
- 两者都通过 `127.0.0.1` 上的本机 API 通信（默认端口 47321），用保存在 `%APPDATA%\Dot Matrix Studio\agent-api.json` 中的随机令牌保护。请求必须指向本机 Host 并携带令牌请求头，所以网页无法控制点阵屏。

MCP 客户端配置示例：`{"command": "node", "args": ["%APPDATA%\\Dot Matrix Studio\\mcp\\server.cjs"]}`。

常用脚本：`pnpm desktop:start`（构建并运行）、`pnpm desktop:dist`（生成安装包）、`pnpm start:fast`（在 4321 端口运行生产构建的网页版；32×32 网格下比 `pnpm dev` 快很多）。

## 开发

环境要求：

- Node.js 20+
- pnpm 11+

安装依赖并启动开发服务器：

```bash
pnpm install
pnpm dev
```

打开：

```text
http://127.0.0.1:3000/editor
```

生产构建：

```bash
pnpm build
pnpm start --hostname 127.0.0.1 --port 3000
```

## 验证

运行类型检查、运动和导出测试：

```bash
pnpm test
```

单项检查：

```bash
pnpm typecheck
pnpm test:motion
pnpm test:exports
pnpm test:idotmatrix   # GIF/蓝牙分包、实时推流
pnpm test:agent        # agent 显示、桌面端 API、MCP 工具
```

浏览器层面的检查在 `scripts/` 中，使用 Playwright。`scripts/platform-web-qa.mjs` 会验证真实渲染出的像素、裁切、连续运动以及 6 FPS 序列的时间线。

## 项目结构

```text
src/
  app/                         Next.js 路由和全局样式
  components/editor/           画布、属性面板、预览和导出界面
  lib/core/                    共用的运动采样和时间线
  lib/exporters/               Web 和 SwiftUI 代码生成器
  lib/idotmatrix/              LED 点阵屏：32x32 渲染、GIF/PNG 编码、蓝牙协议与连接
  lib/agent-display/           agent 表情、状态图标、像素字体和场景
  stores/                      Zustand 编辑器状态和持久化
  toolcraft/                   编辑器使用的 Toolcraft UI 源码
  types/                       核心项目和动画类型
desktop/src/                   Electron 主进程、本机 agent API、托盘
mcp/src/                       MCP 服务器和 hook 命令行
scripts/                       运动、导出、点阵屏、桌面端和 MCP 测试；桌面构建脚本
```

## 部署

应用不需要任何服务端服务、数据库、账号系统或环境变量。Vercel 可以用标准的 Next.js 设置直接从本仓库部署。

常规生产构建：

```bash
pnpm install --frozen-lockfile
pnpm build
```

## 致谢与第三方许可

编辑器包含 Orb 项目用于属性面板和控件系统的 Toolcraft UI 源码。其中的 Toolcraft 代码保留了 Pixel Point 的 MIT 许可声明，详见 [TOOLCRAFT_LICENSE.md](./TOOLCRAFT_LICENSE.md)。
