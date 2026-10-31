import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineNitroConfig } from "nitro/config";

const dir = fileURLToPath(new URL(".", import.meta.url));

// Nitro 服务端：node-middleware 预设（serve.mjs 挂载到统一网关 Unix Socket）
export default defineNitroConfig({
  preset: "node-middleware",
  baseURL: "/app/ai-study/",
  serverDir: resolve(dir, "server"),
  output: {
    dir: resolve(dir, ".fnos-build/.server-dist"),
  },
  publicAssets: [
    {
      dir: resolve(dir, ".fnos-build/.ui-dist"),
    },
  ],
});
