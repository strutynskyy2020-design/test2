"use strict";
// Run from any directory: node backend/scripts/build_pixel_drive_runtime.cjs [--check]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const base = path.resolve(__dirname,"..");
const source = path.resolve(base,"../frontend/src/games/pixel-drive");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const configBytes = fs.readFileSync(path.join(source,"config.json"));
const config = JSON.parse(configBytes);
const entry = path.join(__dirname,"pixel_drive_runtime_entry.cjs");
function hashSources(files) {
  return Object.fromEntries([...new Set(files)].sort().map(file =>
    [file,sha(fs.readFileSync(file === "runtime_entry" ? entry : path.join(source,file)))]));
}
const out = path.join(base,"pixel_drive_runtime.cjs");
const manifestPath = path.join(base,"pixel_drive_runtime.manifest.json");
if (process.argv.includes("--check")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath,"utf8"));
  const hashes = hashSources(Object.keys(manifest.sources));
  if (JSON.stringify(manifest.sources) !== JSON.stringify(hashes)
      || manifest.version !== config.version || manifest.config_sha256 !== sha(configBytes)
      || sha(fs.readFileSync(path.join(base,"pixel_drive_config.json"))) !== sha(configBytes)
      || manifest.runtime_sha256 !== sha(fs.readFileSync(out))) {
    console.error("Pixel Drive replay bundle is stale. Run the build script and include all generated backend files.");
    process.exit(1);
  }
  console.log("Pixel Drive replay bundle matches browser engine, configuration and Planck source.");
} else {
  const webpack = require(path.resolve(base,"../frontend/node_modules/webpack"));
  webpack({
    mode:"production", target:"node24", devtool:false,
    entry,
    output:{path:base,filename:"pixel_drive_runtime.cjs"},
    optimization:{minimize:false},
    plugins:[new webpack.DefinePlugin({__PIXEL_DRIVE_CONFIG_SHA__:JSON.stringify(sha(configBytes))})]
  },(error,stats) => {
    if (error || stats.hasErrors()) {
      console.error(error || stats.toString({all:false,errors:true})); process.exitCode=1; return;
    }
    // Follow webpack's actual dependency graph, including future physics/terrain modules.
    const inputs = [...stats.compilation.fileDependencies]
      .filter(file => file.startsWith(source+path.sep) && fs.statSync(file).isFile())
      .map(file => path.relative(source,file).split(path.sep).join("/"));
    const hashes = hashSources([...inputs,"engine.js","config.json","vendor/PLANCK-LICENSE.txt","runtime_entry"]);
    fs.writeFileSync(path.join(base,"pixel_drive_config.json"),configBytes);
    fs.copyFileSync(path.join(source,"vendor/PLANCK-LICENSE.txt"),path.join(base,"pixel_drive_runtime.LICENSE.txt"));
    fs.writeFileSync(manifestPath,JSON.stringify({
      version:config.version,engine:"Planck 1.5.0",sources:hashes,
      config_sha256:sha(configBytes),runtime_sha256:sha(fs.readFileSync(out))
    },null,2)+"\n");
    console.log(`Built standalone Pixel Drive v${config.version} replay (${fs.statSync(out).size} bytes).`);
  });
}
