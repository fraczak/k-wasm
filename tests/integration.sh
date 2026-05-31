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
node ./bin/k-wasm-compile.mjs -k "$TMP_DIR/ok.k" "$TMP_DIR/ok.wasm"
node "$K_ROOT/codecs/unit.mjs" --parse > "$TMP_DIR/unit.kv"
node ./bin/k-wasm-run.mjs "$TMP_DIR/ok.wasm" "$TMP_DIR/unit.kv" |
  node "$K_ROOT/codecs/k-print.mjs" |
  grep -qx '"ok"'

node "$K_ROOT/objects/compile-lib.mjs" "$K_ROOT/Examples/ieee.k" "$TMP_DIR/ieee.klib"
MUL=`node "$K_ROOT/objects/extract-aliases.mjs" "$TMP_DIR/ieee.klib" |
  sed -n 's/^mul = \(@[^;]*\);.*$/\1/p'`
node ./bin/k-wasm-compile.mjs --lib "$TMP_DIR/ieee.klib" "{()x,()y} $MUL .result" "$TMP_DIR/ieee-mul.wasm"
echo 0.12 |
  node "$K_ROOT/codecs/ieee.mjs" --parse |
  node ./bin/k-wasm-run.mjs "$TMP_DIR/ieee-mul.wasm" |
  node "$K_ROOT/codecs/ieee.mjs" --print |
  grep -qx '0.0144'

echo "Integration tests passed."
