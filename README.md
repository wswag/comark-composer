# comark-composer

Locale-aware content composition for Comark. Define a shared layout once, provide named localized fragments, and resolve the result to a native, serializable `MarkdownDocument`.

## Status and compatibility

Version `0.1.0` targets Comark `>=0.7.0 <0.8.0`, verified against Comark `0.7.x`. The package is ESM and runs on Node.js 20 or newer. The resolver core does not depend on Vue or a renderer. It uses Comark's `parseMarkdown` API and native AST tuples. `comark-include` was reviewed: it pastes filesystem files before parsing and supports relative paths and regions, but its file context and include grammar do not provide this package's resource IDs, locale fallback, inherited fragment scope, or layout contract. The resolver therefore implements its own composition over Comark ASTs, not a Markdown parser.

The official [`comark-plugin-template`](https://github.com/comarkdown/comark-plugin-template) supplies the TypeScript, ESM/declaration build, Vitest, playground and CI project structure. Comark plugins expose synchronous parser hooks; composition requires asynchronous repository access before rendering, so the stable API here is `createContentResolver()` rather than a second plugin implementation.

## Install

Install from a fixed Git tag after publishing the repository:

```sh
npm install git+ssh://git@<host>/<org>/comark-composer.git#v0.1.0
```

`prepare` builds `dist/` when npm installs the package from Git, so generated files do not need to be committed. The GitHub workflow installs the checked-out repository into a clean consumer project and imports the public API. Create a fixed release tag only after CI passes. A public npm package is not required.

## Content layout

```text
content/
  shared/features.md
  de/features.md
  en/features.md
```

Localized document:

```md
---
id: features
  layout: shared/features
title: Funktionen
---
::fragment{name="intro"}
## Planung, die zu dir passt

Dein persönlicher Essensplan.
::
```

Shared layout:

```md
::feature-grid
  ::feature-card
  ::include{fragment="intro"}
  ::
::
```

`layout` names a shared resource. Layout documents may only contain fragment includes and whitespace/comments outside their fragment declarations. The localized document's frontmatter remains authoritative.

## API

```ts
import { createContentResolver } from 'comark-composer'
import { createFilesystemRepository } from 'comark-composer/filesystem'

const resolver = createContentResolver({
  repository: createFilesystemRepository('./content'),
  fallbackLocales: ['en'],
})

const result = await resolver.resolve({ id: 'features', locale: 'de' })
// result.document is a Comark MarkdownDocument
// result.dependencies and result.diagnostics are separate from the document
```

`ContentRepository.load()` returns `null` only for a missing resource. Other errors propagate. Localized resources are tried in the requested locale and then in configured fallback order. Shared resources are loaded from `shared/` without fallback. The filesystem adapter maps IDs to `<root>/<locale>/<id>.md` and `<root>/shared/<id>.md`, rejects traversal, and checks symlink targets against the content root.

Resolver limits default to depth 32, 1,000 expansions, and 100,000 output AST nodes. Configure them with `maxDepth`, `maxExpansions`, and `maxOutputNodes`. Failures throw `CompositionError`, whose `diagnostic` contains a stable code and resource chain. Successful locale fallbacks and unused fragments are returned as diagnostics.

## Include syntax

```md
::include{fragment="intro"}::
::include{src="pricing"}::
::include{src="shared/features"}::
::include{src="features" fragment="intro"}::
```

Without `src`, `fragment` looks up the lexical caller context. A localized `src` selects the current effective locale (and may use configured locale fallback). `shared/<id>` explicitly selects a shared resource. With `src` and no `fragment`, the target's whole resolved body is inserted. Includes are block components and their markers are removed during resolution.

Errors include `RESOURCE_NOT_FOUND`, `FRAGMENT_NOT_FOUND`, `DUPLICATE_FRAGMENT`, `INCLUDE_CYCLE`, `LAYOUT_BODY_CONTENT`, `INVALID_RESOURCE_ID`, and limit errors such as `MAX_DEPTH`. They are never silently replaced with empty content.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

The build emits ESM and `.d.ts` files under `dist/`. The GitHub workflow runs typechecking, tests, and build. A release tag should only be created after all checks pass and a clean-consumer Git-install check has been added to CI.
