// electron-builder hook: start the real binary with --no-sandbox. Ubuntu 24.04+
// blocks Chromium's user-namespace sandbox for AppImages, and the setuid helper
// can't work inside one, so without this the app aborts before any JS runs.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'linux') return;
  const exe = path.join(ctx.appOutDir, ctx.packager.executableName);
  fs.renameSync(exe, exe + '.bin');
  fs.writeFileSync(exe, `#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/${ctx.packager.executableName}.bin" --no-sandbox "$@"\n`, { mode: 0o755 });
};
