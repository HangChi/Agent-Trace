const { rmSync, statSync } = require("node:fs");
const { join } = require("node:path");

// Chromium ships these but a local dashboard UI never uses WebGPU shader
// compilation, so the DXC compiler can be dropped. LICENSES.chromium.html is a
// ~20MB aggregated license text file (a copy is kept in the repo for compliance).
const removableFiles = ["dxcompiler.dll", "dxil.dll", "LICENSES.chromium.html"];

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  let removedBytes = 0;

  for (const name of removableFiles) {
    const target = join(appOutDir, name);

    try {
      removedBytes += statSync(target).size;
      rmSync(target, { force: true });
      console.log(`  afterPack: removed ${name}`);
    } catch {
      // File not present for this platform/arch; nothing to remove.
    }
  }

  if (removedBytes > 0) {
    console.log(`  afterPack: trimmed ${(removedBytes / 1024 / 1024).toFixed(1)} MB`);
  }
};
