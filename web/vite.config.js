import {copyFile, mkdir, readFile, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {defineConfig} from "vite";

function sitesBundle() {
  let root;
  return {
    name: "reeftone-sites-bundle",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await rm(resolve(root, "dist"), {recursive: true, force: true});
    },
    async closeBundle() {
      const serverDirectory = resolve(root, "dist/server");
      const metadataDirectory = resolve(root, "dist/.openai");
      await rm(serverDirectory, {recursive: true, force: true});
      await mkdir(serverDirectory, {recursive: true});
      await mkdir(metadataDirectory, {recursive: true});
      await copyFile(resolve(root, "worker/index.js"), resolve(serverDirectory, "index.js"));
      await copyFile(
        resolve(root, ".openai/hosting.json"),
        resolve(metadataDirectory, "hosting.json"),
      );
      await readFile(resolve(root, "dist/static/index.html"), "utf8");
    },
  };
}

export default defineConfig({
  plugins: [sitesBundle()],
  build: {
    outDir: "dist/static",
    target: "es2022",
    sourcemap: true,
  },
});
