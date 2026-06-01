# k WebAssembly Backend

`@fraczak/k-wasm` is the experimental WebAssembly backend for
[`@fraczak/k`](https://github.com/fraczak/k). It lowers typed k programs through
the kVM representation, emits standard `.wasm` modules with WABT, and provides
a Node.js runner for the binary `pattern + value` streams used by the k codec
toolchain.

## Install

Install dependencies from a checkout:

```bash
npm install
```

Optionally expose the three backend commands on your path:

```bash
npm link
```

When developing this backend alongside a sibling k checkout, link that checkout
instead of using the published dependency:

```bash
npm link --no-save ../k
```

## Quick Start

Compile an expression into a standalone WebAssembly artifact:

```bash
node ./bin/k-wasm-compile.mjs '|ok' /tmp/ok.wasm
```

Run it over the unit value and print the decoded result:

```bash
node ./node_modules/@fraczak/k/codecs/unit.mjs --parse |
  node ./bin/k-wasm-run.mjs /tmp/ok.wasm |
  node ./node_modules/@fraczak/k/codecs/k-print.mjs
```

Expected output:

```json
"ok"
```

With the backend and k codec commands on your path, the equivalent shorter
form is:

```bash
k-wasm-compile '|ok' /tmp/ok.wasm
k-unit --parse | k-wasm-run /tmp/ok.wasm | k-print
```

## Commands

| Command | Purpose |
| --- | --- |
| `k-wasm` | Compile a k expression or source file in memory and run it immediately |
| `k-wasm-compile` | Compile a k expression or source file into a `.wasm` artifact |
| `k-wasm-run` | Run an existing `.wasm` artifact over a binary input stream |

All commands accept `--help`. The compile commands accept repeated `--lib`
options for `.klib` dependencies and `-k file` for source files. The runners
read a binary input stream from standard input unless an input file is given.

## Artifacts

The compiler produces a standard WebAssembly binary module containing the
reachable relations, the arena runtime, and a `k.metadata` custom section. The
metadata stores the entry point and the pattern information needed to encode
and decode values. A compiled artifact can be run later without its original k
source or `.klib` files.

The current host runner targets Node.js. It is still needed to bridge between
WebAssembly linear memory and k binary streams.

## Development

Run the test suite:

```bash
npm test
```

Run the comparative IEEE benchmark:

```bash
npm run perf:ieee
```

See [DOCS/USE-WEB-ASSEMBLY.md](DOCS/USE-WEB-ASSEMBLY.md) for the artifact
format, source-file and library examples, profiling options, and current
limitations.
