/* Build-time entry only. Production executes the committed standalone bundle. */
"use strict";
const engine = require("../../frontend/src/games/pixel-drive/engine");
const progression = require("../../frontend/src/games/pixel-drive/progression");
// Planck 1.5.0 declares Node >=24; match its supported server runtime.
if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1);
const MAX_BYTES = 1048576;
const metadata = {version: engine.CONFIG.version, config_sha256: __PIXEL_DRIVE_CONFIG_SHA__};
function reply(value) {
  const output = JSON.stringify({...metadata, ...value});
  if (Buffer.byteLength(output) > 262144) process.exit(1);
  process.stdout.write(output);
}
let size = 0;
const chunks = [];
process.stdin.on("data", chunk => {
  size += chunk.length;
  if (size > MAX_BYTES) process.exit(1);
  chunks.push(chunk);
});
process.stdin.on("error", () => process.exit(1));
process.stdin.on("end", () => {
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return reply({ok:false, kind:"protocol"}); }
  if (!data || data.version !== metadata.version || data.config_sha256 !== metadata.config_sha256)
    return reply({ok:false, kind:"protocol"});
  if (data.op === "health") return reply({ok:true});
  if (["migrate", "award", "purchase"].includes(data.op)) {
    try {
      const result = data.op === "migrate" ? {progress: progression.migrateProgress(data.profile)} :
        data.op === "award" ? progression.awardProgress(data.profile, engine.getLevel(data.level), data.outcome) :
          progression.purchaseProgress(data.profile, data.part, data.from);
      return reply({ok:true, ...result});
    } catch (_) {return reply({ok:false, kind:"invalid_economy"});}
  }
  if (data.op !== "replay") return reply({ok:false, kind:"protocol"});
  try {
    if (!Number.isInteger(data.level) || data.level < 1 || data.level > engine.CONFIG.levels.length
        || !Array.isArray(data.events) || typeof data.abandon !== "boolean")
      return reply({ok:false, kind:"invalid_replay", error:"Некоректний заїзд"});
    const outcome = engine.replay(engine.getLevel(data.level), data.upgrades, data.events, data.ticks, data.abandon);
    reply({ok:true, outcome});
  } catch (error) {
    if (error.code === "INVALID_REPLAY" || error.name === "ReplayValidationError")
      reply({ok:false, kind:"invalid_replay", error:String(error.message).slice(0,200)});
    else reply({ok:false, kind:"worker_failure"});
  }
});
