# build/

Build system for the agent: compilation flags, cross-compilation toolchains,
CI pipeline definitions, and the `make` / `dda` invocation entrypoints.

Common issues that belong here: build failures, missing build dependencies,
compiler/linker errors, CI pipeline breakage, slow builds, cache misses.

Owned by `@DataDog/agent-build`.
