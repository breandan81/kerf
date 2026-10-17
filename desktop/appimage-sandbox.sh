#!/bin/bash
# Let AppImages use Chromium/Electron's sandbox on Ubuntu 23.10+ so they no
# longer need --no-sandbox.  Run once:  sudo ./appimage-sandbox.sh
# Undo:  sudo ./appimage-sandbox.sh --remove
#
# Why: Ubuntu now only lets programs create user namespaces (what the Chromium
# sandbox is built on) if an AppArmor profile says they may. Apps installed from
# .deb/snap ship such a profile; AppImages can't, because they run from a
# temporary mount (/tmp/.mount_XXXXXX). Chromium's fallback, the setuid helper
# chrome-sandbox, can't work inside an AppImage either (the mount is nosuid), so
# Electron aborts. This adds one profile, in the same form Ubuntu uses for
# Chrome, VS Code and Obsidian: anything running from an AppImage mount may
# create user namespaces and is otherwise unconfined, like before the change.
set -e
P=/etc/apparmor.d/appimages
if [ "$(id -u)" != 0 ]; then echo "run with sudo"; exit 1; fi
if [ "$1" = "--remove" ]; then
  apparmor_parser -R "$P" 2>/dev/null || true
  rm -f "$P"
  echo "removed $P"
  exit 0
fi
cat > "$P" <<'PROFILE'
# AppImages (FUSE mount or --appimage-extract-and-run) may use user
# namespaces for the Chromium/Electron sandbox. Installed by appimage-sandbox.sh
abi <abi/4.0>,
include <tunables/global>

profile appimages /tmp/{.mount_*,appimage_extracted_*}/** flags=(unconfined) {
  userns,
  include if exists <local/appimages>
}
PROFILE
apparmor_parser -r "$P"
echo "installed $P — AppImages can now run with the sandbox on (drop --no-sandbox)"
