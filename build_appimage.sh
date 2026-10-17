#!/bin/bash
# Build the desktop app: desktop/release/Kerf-<version>-x86_64.AppImage
set -e
cd "$(dirname "$0")"
export PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH
./build_web.sh
rm -rf desktop/app && cp -r dist desktop/app
cd desktop
[ -d node_modules ] || npm install
npx electron-builder --linux AppImage
ls -lh release/*.AppImage
