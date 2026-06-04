# Technical Debt

## Polymorphic Input Retyping for Precompiled Wasm

`k-wasm` can retype a polymorphic program when it compiles and runs in one step:
the CLI decodes the input stream first, intersects the program input pattern with
the input value envelope, and compiles a specialized WebAssembly module for that
run.

`k-wasm-run` cannot currently do the same for an already compiled `.wasm`
artifact. By the time the runner sees the input envelope, the k program has
already been lowered to WebAssembly and the artifact only carries metadata such
as the generic input/output patterns. The original source/object relation graph
needed to re-run type derivation is not available.

This means precompiled artifacts can execute polymorphic programs, but their
output envelopes are limited to the generic artifact metadata rather than being
retyped against each input envelope.

One possible fix is to delay compilation for programs with polymorphic input
until the input envelope is available. That could mean storing enough source,
object, or typed relation data in the artifact to specialize on first run, or
using a separate artifact form for deferred compilation.
