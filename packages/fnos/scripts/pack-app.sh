#!/bin/bash
set -euo pipefail
# app/ 目录打包为 app.tgz 并把 md5 写回 manifest checksum
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/.fnos-build/package"

mkdir -p "${ROOT_DIR}/.fnos-build/dist"
rm -f "${ROOT_DIR}/.fnos-build/dist/app.tgz"

tar -czf "${ROOT_DIR}/.fnos-build/dist/app.tgz" -C "${BUILD_DIR}" app

node -e '
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.argv[1];
const appTgz = path.join(root, ".fnos-build/dist/app.tgz");
const manifestPath = path.join(root, ".fnos-build/package/manifest");
const checksum = crypto.createHash("md5").update(fs.readFileSync(appTgz)).digest("hex");
const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).map((line) => line.startsWith("checksum=") ? `checksum=${checksum}` : line);
fs.writeFileSync(manifestPath, lines.join("\n").replace(/\n*$/, "\n"));
' "${ROOT_DIR}"

echo "Generated: .fnos-build/dist/app.tgz"
