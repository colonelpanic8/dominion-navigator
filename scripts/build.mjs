import * as esbuild from "esbuild";
import { cleanDist, copyStatic, esbuildConfigs } from "./lib/extension-build.mjs";

await cleanDist();
for (const config of esbuildConfigs()) await esbuild.build(config);
await copyStatic();
