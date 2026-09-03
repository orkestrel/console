# Guides

A dual-axis index into this repository's guides — by concept, and by
directory.

## By concept

| Concept | Spec                       | Source                                                                                    | Tests                                                                                                                         |
| ------- | -------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Console | [`console.md`](console.md) | [`src/core`](../src/core), [`src/browser`](../src/browser), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/browser`](../tests/src/browser), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory     | Guide                      |
| ------------- | -------------------------- |
| `src/core`    | [`console.md`](console.md) |
| `src/browser` | [`console.md`](console.md) |
| `src/server`  | [`console.md`](console.md) |

## Dependency reference

[`contract.md`](contract.md) is a byte-identical mirror of the guide for
`@orkestrel/contract` — one of this package's runtime dependencies. It documents
**that package's** surface (guards, combinators, parsers, and the shape DSL), not
anything sourced in this repo; it is kept here so a reader of this package can see
the primitives it is built from without leaving this guide set.

[`emitter.md`](emitter.md) is a byte-identical mirror of the guide for
`@orkestrel/emitter` — this package's other runtime dependency. It documents
**that package's** surface (the `Emitter` class, `EmitterInterface`, and the
listener-isolation contract), not anything sourced in this repo; it is kept here
so a reader of this package can see the primitives it is built from without
leaving this guide set.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

[`probe.md`](probe.md) is a byte-identical mirror of the guide for
`@orkestrel/probe` — the devDependency this repo's typecheck probes run
through. It documents **that package's** surface (the `prove` tool and the
stages behind it), not anything sourced in this repo; it is kept here so a
reader of a typecheck claim can see the instrument it was proved with without
leaving this guide set.

[`scaffold.md`](scaffold.md) is a byte-identical mirror of the guide for
`@orkestrel/scaffold` — the devDependency supplying this repo's shared file set
and toolchain. It documents **that package's** surface (the registry, the
catalog, and the file passes), not anything sourced in this repo; it is kept
here so a reader of this repo's configuration can see the tooling that generates
it without leaving this guide set.

[`test.md`](test.md) is a byte-identical mirror of the guide for
`@orkestrel/test` — the devDependency supplying this repo's shared test
infrastructure. It documents **that package's** surface (the call recorder, the
waits, the collectors, and the owned scratch directory), not anything sourced in
this repo; it is kept here so a reader of this repo's suites can see the helpers
they are built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; see § Documentation contract.
