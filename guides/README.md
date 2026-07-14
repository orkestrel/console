# Guides

A dual-axis index into this repository's guides — by concept, and by
directory (AGENTS §22).

## By concept

| Concept | Spec                               | Source                                                                                    | Tests                                                                                                                         |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Console | [`src/console.md`](src/console.md) | [`src/core`](../src/core), [`src/browser`](../src/browser), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/browser`](../tests/src/browser), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory     | Guide                              |
| ------------- | ---------------------------------- |
| `src/core`    | [`src/console.md`](src/console.md) |
| `src/browser` | [`src/console.md`](src/console.md) |
| `src/server`  | [`src/console.md`](src/console.md) |

## Dependency reference

[`src/contract.md`](src/contract.md) is a byte-identical mirror of the guide for
`@orkestrel/contract` — one of this package's runtime dependencies. It documents
**that package's** surface (guards, combinators, parsers, and the shape DSL), not
anything sourced in this repo; it is kept here so a reader of this package can see
the primitives it is built from without leaving this guide set.

[`src/emitter.md`](src/emitter.md) is a byte-identical mirror of the guide for
`@orkestrel/emitter` — this package's other runtime dependency. It documents
**that package's** surface (the `Emitter` class, `EmitterInterface`, and the
listener-isolation contract), not anything sourced in this repo; it is kept here
so a reader of this package can see the primitives it is built from without
leaving this guide set.

[`src/guide.md`](src/guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides/src/parity.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
