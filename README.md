# @orkestrel/console

A unified output-control system for the `@orkestrel` line — one
environment-agnostic engine composing five concerns over a shared substrate:
a **style engine** (`Styler` + `ANSIRenderer`, style as data), **structured
logging** (`Logger`, `LoggerManager`), **narrative reporting** (`Reporter`),
**console & stream capture** (`Capture`, `ProcessCapture`), and **live
animations** (`Spinner`, `Progress`). Built to sit beside `@orkestrel/emitter`
(observable lifecycle), reusing it as it takes shape.

## Install

```sh
npm install @orkestrel/console
```

## Requirements

- Node.js >= 24
- Core is ESM; the `./server` subpath ships dual ESM+CJS builds; `./browser`
  is ESM-only

## Usage

The same code retargets to any environment by swapping the `sink`:

```ts
import { Logger, Reporter, Spinner } from '@orkestrel/console'

const logger = new Logger({ name: 'http', level: 'info' }) // ANSI to the console by default
logger.info('request', { method: 'GET', path: '/' }) // a styled, leveled line + an `entry` event
logger.emitter.on('entry', (record) => archive(record)) // the transport seam — file / JSON / remote

const reporter = new Reporter()
reporter.section('Build')
reporter.step('bundling', { index: 2, total: 5 }) // [2/5] bundling
reporter.status('success', 'built in 1.2s') // ✔ built in 1.2s

const spinner = new Spinner({ message: 'deploying' })
spinner.start() // a self-driving glyph cycle, `\r`-redrawn by an overwrite-capable sink
spinner.succeed('deployed') // ✔ deployed — the timer cleared, the line committed
```

Style is data — a `Style` is a frozen record rendered through a swappable
`RendererInterface` (`ANSIRenderer` by default):

```ts
import { createStyler } from '@orkestrel/console'

const styler = createStyler()
console.log(styler.red.bold('hi')) // renders through the injected renderer
```

Take control of `console.*` on the read side with `Capture`:

```ts
import { Capture } from '@orkestrel/console'

const capture = new Capture({ mirror: true })
capture.start()
console.log('hello')
capture.messages() // [{ level: 'log', text: 'hello', time: ... }]
capture.stop()
```

On the server, `ProcessCapture` takes over the whole `process` output surface
(direct `process.stdout`/`stderr` writes, not just `console.*`):

```ts
import { createProcessCapture } from '@orkestrel/console/server'

const capture = createProcessCapture({ levels: ['stderr'], mirror: true })
capture.start()
```

## Guide

See [guides/src/console.md](./guides/src/console.md) for the full documented
surface — styling, logging, reporting, capture, and animations.

## Package

Published as three environment-scoped entry points per the `exports` field
in `package.json`: `.` (the shared, environment-agnostic core engine, the
default ANSI renderer, and the console sink), `./server` (adds the server
sink and `ProcessCapture`), and `./browser` (adds the browser sink
translating ANSI to `console.log('%c…', css)`). Core and `./server` ship
dual ESM+CJS builds; `./browser` is ESM-only.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
