#!/usr/bin/env bash
set -euo pipefail

K_ROOT=${K_ROOT:-./node_modules/@fraczak/k}
TMP_DIR=`mktemp -d`
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Running './tests/integration.sh' ..."

node "$K_ROOT/codecs/unit.mjs" --parse |
  node ./bin/k-wasm.mjs '|ok' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

printf '{"a": {}, "b": {}}\n' |
  node "$K_ROOT/codecs/k-parse.mjs" |
  node ./bin/k-wasm.mjs '|ok' |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '{"ok":{"a":{},"b":{}}}'

printf '|ok\n' > "$TMP_DIR/ok.k"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/ok.k" "$TMP_DIR/ok.wasm"
node "$K_ROOT/codecs/unit.mjs" --parse > "$TMP_DIR/unit.kv"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node ./bin/k-wasm.mjs "$TMP_DIR/ok.k" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile.mjs" "$TMP_DIR/ok.k" "$TMP_DIR/ok.ko"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/ok.ko" "$TMP_DIR/ok-ko.wasm"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok-ko.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile.mjs" "$TMP_DIR/ok.k" "$TMP_DIR/ok.kvm"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/ok.kvm" "$TMP_DIR/ok-kvm.wasm"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok-kvm.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile.mjs" --format kvm 'make_prod = { .x x, .y y }; proj_y = make_prod .y; proj_y' > "$TMP_DIR/project.kvm"
node ./bin/k-wasm-compile.mjs "$TMP_DIR/project.kvm" "$TMP_DIR/project.wasm"
printf '{"x":{"a":{}},"y":{"b":{}}}\n' |
  node "$K_ROOT/codecs/k-parse.mjs" |
  node ./bin/k-wasm-run.mjs "$TMP_DIR/project.wasm" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"b"'

node "$K_ROOT/objects/compile.mjs" "$K_ROOT/Examples/ieee.k" "$TMP_DIR/ieee.klib"
node ./bin/k-wasm-compile.mjs --lib "$TMP_DIR/ieee.klib" --export mul:times "{()x,()y} times .result" "$TMP_DIR/ieee-mul.wasm"
echo 0.12 |
  node "$K_ROOT/codecs/ieee.mjs" --parse |
  node ./bin/k-wasm-run.mjs "$TMP_DIR/ieee-mul.wasm" |
  node "$K_ROOT/codecs/ieee.mjs" --print |
  grep -qx '0.0144'

echo "Integration tests passed."
