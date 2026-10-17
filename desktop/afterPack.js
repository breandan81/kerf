// electron-builder hook: start the real binary through a small shell script.
// Ubuntu 23.10+ only lets programs create user namespaces (the Chromium
// sandbox) if an AppArmor profile allows it, and the setuid fallback can't work
// inside an AppImage, so Electron aborts at startup. The script tries the
// sandbox first and, only if that start-up abort happens, runs without it.
// desktop/appimage-sandbox.sh installs a profile so the sandbox works.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'linux') return;
  const exe = path.join(ctx.appOutDir, ctx.packager.executableName);
  fs.renameSync(exe, exe + '.bin');
  const bin = ctx.packager.executableName + '.bin';
  fs.writeFileSync(exe, `#!/bin/sh
bin="$(dirname "$(readlink -f "$0")")/${bin}"
[ -n "$KERF_NO_SANDBOX" ] && exec "$bin" --no-sandbox "$@"
start=$(date +%s)
"$bin" "$@"
rc=$?
# 133 = SIGTRAP: Chromium refusing to start without a usable sandbox
if [ $rc -eq 133 ] && [ $(( $(date +%s) - start )) -lt 10 ]; then
  echo "Kerf: sandbox unavailable on this system, starting without it (see appimage-sandbox.sh)" >&2
  exec "$bin" --no-sandbox "$@"
fi
exit $rc
`, { mode: 0o755 });
};
