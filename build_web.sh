#!/bin/bash
# Build the static, server-less site into dist/ (files live in the browser
# or in a folder the user opens; fonts are bundled).
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/vendor/codemirror/addon dist/vendor/three/build dist/vendor/three/addons/controls
cp -r index.html css js lib fonts tutorial examples dist/
cp vendor/clipper.js vendor/opentype.min.js dist/vendor/
cp -r vendor/codemirror/lib dist/vendor/codemirror/
for a in mode edit comment dialog search; do cp -r vendor/codemirror/addon/$a dist/vendor/codemirror/addon/; done
cp vendor/three/build/three.module.js vendor/three/build/three.core.js dist/vendor/three/build/
cp vendor/three/addons/controls/OrbitControls.js dist/vendor/three/addons/controls/
# list of example files to seed a new browser project with
(cd examples && find . -type f ! -name manifest.json | sed 's#^\./##' | sort | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))') > dist/examples/manifest.json
echo "built dist/ ($(du -sh dist | cut -f1))"
