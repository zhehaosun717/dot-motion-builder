/** Set by `pnpm desktop:build`: a static export the Electron app serves from 127.0.0.1. */
const desktopExport = process.env.DESKTOP_EXPORT === "1";

/** @type {import('next').NextConfig} */
const webConfig = {
  devIndicators: false,
  outputFileTracingRoot: new URL(".", import.meta.url).pathname,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/editor",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" }
        ]
      }
    ];
  }
};

/** @type {import('next').NextConfig} */
const desktopConfig = {
  devIndicators: false,
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  // With output: "export", Next writes the static site straight into distDir.
  distDir: "out"
};

export default desktopExport ? desktopConfig : webConfig;
