#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive_path="${repository_root}/out/decky-speed-test-China.zip"
staging_directory="$(mktemp -d /tmp/decky-speed-test-package.XXXXXX)"

cleanup() {
  rm -rf "${staging_directory}"
}
trap cleanup EXIT

cd "${repository_root}"
pnpm build

mkdir -p "${staging_directory}/decky-speed-test-China/dist" "${repository_root}/out"
cp LICENSE README.md main.py package.json plugin.json \
  "${staging_directory}/decky-speed-test-China/"
cp dist/index.js dist/index.js.map \
  "${staging_directory}/decky-speed-test-China/dist/"

cd "${staging_directory}"
rm -f "${archive_path}"
zip -9 -X -r "${archive_path}" decky-speed-test-China

echo "Created ${archive_path}"
shasum -a 256 "${archive_path}"
