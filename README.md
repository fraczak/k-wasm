# k WebAssembly Backend

This repository contains the experimental WebAssembly backend for
[`@fraczak/k`](https://github.com/fraczak/k). It lowers typed k programs through
the kVM representation, uses WABT to emit binary modules, and provides a Node.js
runner for binary `pattern + value` streams.

Install dependencies:

```bash
npm install
```

Until the backend API is available in a published `@fraczak/k` release, link a
sibling core checkout for local development:

```bash
npm link --no-save ../k
```

Compile and run a small program:

```bash
k-wasm-compile '|ok' /tmp/ok.wasm
k-unit --parse |
  k-wasm-run /tmp/ok.wasm |
  k-print
```

See [DOCS/USE-WEB-ASSEMBLY.md](DOCS/USE-WEB-ASSEMBLY.md) for the artifact
format, CLI usage, and current limitations.
