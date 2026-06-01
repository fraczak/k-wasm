# Using WebAssembly

The experimental WebAssembly backend can compile a k program into a binary
`.wasm` artifact and run that artifact later without loading the original k
source. It uses the same binary `pattern + value` streams as the normal `k`
runtime, so the existing codecs remain the pipeline boundaries.

## Install the Commands

From a checkout:

```bash
npm install
npm link
```

Until the required backend API is available in a published `@fraczak/k`
release, the dependency is pinned to the GitHub core revision that introduced
it.

When developing both repositories together, optionally link a sibling core
checkout:

```bash
npm link --no-save ../k
```

This installs three commands:

| Command | Purpose |
| --- | --- |
| `k-wasm` | Compile a k program in memory and run it immediately |
| `k-wasm-compile` | Compile a k program into a standalone `.wasm` artifact |
| `k-wasm-run` | Run a previously compiled `.wasm` artifact |

The same tools can be called directly from a checkout with
`node ./bin/k-wasm.mjs`, `node ./bin/k-wasm-compile.mjs`, and
`node ./bin/k-wasm-run.mjs`.

## Compile and Run a Source File

A source file must end with the expression that becomes its entry point:

```k
|ok
```

Compile it:

```bash
k-wasm-compile -k program.k program.wasm
```

Run it over a binary input stream:

```bash
k-unit --parse |
  k-wasm-run program.wasm |
  k-print
```

Expected output:

```json
"ok"
```

The `.wasm` artifact is a standard WebAssembly binary module:

```bash
file program.wasm
```

It can be stored or transferred as one file. The runner does not need
`program.k` after compilation.

## Compile an Expression

For a small program, pass a k expression directly:

```bash
k-wasm-compile '|ok' program.wasm
```

The `k-wasm` convenience command performs compilation and execution in one
process:

```bash
k-unit --parse |
  k-wasm '|ok' |
  k-print
```

## Read Input from a File

Both runners accept an optional binary input file:

```bash
k-unit --parse > input.kv
k-wasm-run program.wasm input.kv > output.kv
k-print output.kv
```

The one-step command has the same input-file form:

```bash
k-wasm -k program.k input.kv > output.kv
```

## Compile with Libraries

`k-wasm-compile` and `k-wasm` accept repeated `--lib` options before the
program. Loaded relations are content-addressed, so use their canonical hashes
in the program expression.

For a library that defines `transform`:

```bash
k-compile-lib library.k library.klib
TRANSFORM=$(k-extract-aliases library.klib |
  sed -n 's/^transform = \(@[^;]*\);.*$/\1/p')
k-wasm-compile --lib library.klib "$TRANSFORM" program.wasm
k-parse |
  k-wasm-run program.wasm |
  k-print
```

The `.klib` file is required while compiling the artifact. It is not required
when running the resulting `.wasm` file.

## Profile IEEE Execution

The comparative IEEE benchmark moved with the backend:

```bash
npm run perf:ieee
```

To isolate WebAssembly execution and report arena allocation statistics:

```bash
WASM_ONLY=1 WASM_PROFILE=1 ITERATIONS=3 npm run perf:ieee
```

Set `WASM_RESET=0` to reproduce retained-arena growth and
`WASM_WARMUP_ITERATIONS=0` to include cold-start behavior.

## What the Artifact Contains

`k-wasm-compile` produces one WebAssembly binary module. The module contains:

- the bump-allocator runtime from [`runtime.wat`](../runtime.wat)
- one WebAssembly function for each reachable k relation
- the exported `rel___main__` entry point
- a WebAssembly custom section named `k.metadata`

The custom section stores JSON metadata needed by the host runner:

| Field | Meaning |
| --- | --- |
| `format` | Artifact family, currently `k-wasm` |
| `version` | Artifact format version, currently `1` |
| `abi` | Runtime ABI, currently `arena-v1` |
| `entry` | Exported WebAssembly function called by the runner |
| `inputPattern` | Pattern graph used to serialize the input into the arena |
| `outputPattern` | Pattern graph used to decode the output from the arena |
| `tags` | Stable integer IDs assigned to statically known variant tags |

Embedding metadata in a custom section keeps the artifact self-contained.
Unknown WebAssembly engines ignore custom sections, while `k-wasm-run` reads
the section with `WebAssembly.Module.customSections(...)`.

## Compilation Pipeline

Compilation follows these steps:

1. Parse and annotate the k source, including any loaded `.klib` dependencies.
2. Lower the main relation and every reachable relation to kVM instructions.
3. Lower each kVM function to WebAssembly text.
4. Combine the generated functions with `runtime.wat`.
5. Use WABT to validate the text and emit a binary WebAssembly module.
6. Append the `k.metadata` custom section to the binary module.

The implementation lives in [`src/wasm.mjs`](../src/wasm.mjs). The command-line
wrappers are [`k-wasm-compile.mjs`](../bin/k-wasm-compile.mjs),
[`k-wasm-run.mjs`](../bin/k-wasm-run.mjs), and
[`k-wasm.mjs`](../bin/k-wasm.mjs).

## Execution Pipeline

`k-wasm-run` performs these steps:

1. Load and compile the `.wasm` module with Node.js `WebAssembly.compile(...)`.
2. Read and validate the `k.metadata` custom section.
3. Decode the input `pattern + value` stream.
4. Serialize the input tree into the module's linear-memory arena.
5. Call the artifact entry point with the input arena pointer.
6. Decode the returned arena pointer under the stored output pattern.
7. Write the result as a binary `pattern + value` stream.

The WebAssembly entry-point ABI is:

```text
(param input_pointer i32) -> (result output_pointer i32, ok i32)
```

An `ok` result of `1` means that the partial function produced a value. A
result of `0` means that the k relation was undefined for that input.

## Current Limitations

- The artifact is a WebAssembly module, not a native executable. It still needs
  a host runner that understands k binary streams and the `k.metadata` section.
- `k-wasm-run` currently targets Node.js. A browser runner can use the same
  artifact format but has not been added yet.
- `k-wasm-compile` compiles k source or an expression. It does not yet compile
  `.ko` objects.
- The backend is experimental. Use `k` as the general-purpose runtime while
  WebAssembly pattern coverage and optimization continue to evolve.
