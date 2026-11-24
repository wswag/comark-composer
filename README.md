# comark-composer

Locale-aware content composition for Comark. Define a shared layout once, provide named localized fragments, and resolve the result to a native, serializable `MarkdownDocument`.

## Status and compatibility

The package targets Comark `>=0.7.0 <0.8.0`, verified against Comark `0.7.x`, and runs on Node.js 20 or newer. The resolver core does not depend on Vue or a renderer. It uses Comark's `parseMarkdown` API and native AST tuples. `comark-include` was reviewed: it pastes filesystem files before parsing and supports relative paths and regions, but its file context and include grammar do not provide this package's resource IDs, locale fallback, inherited fragment scope, or layout contract. The resolver therefore implements its own composition over Comark ASTs, not a Markdown parser.

The official [`comark-plugin-template`](https://github.com/comarkdown/comark-plugin-template) supplies the TypeScript, ESM/declaration build, Vitest, playground and CI project structure. Comark plugins expose synchronous parser hooks; composition requires asynchronous repository access before rendering, so the stable API here is `createContentResolver()` rather than a second plugin implementation.

## Examples

[`examples/go-vite`](examples/go-vite) demonstrates the full application flow: Go serves Vite-built assets and embedded Markdown, while the browser resolves a localized Comark document through HTTP and renders its native document with `@comark/html`. The template `playground/` is reserved for a compact TypeScript package demo; it is not the right place for a multi-runtime application.

## Install

Install from a fixed Git tag after publishing the repository:

```sh
npm install git+ssh://git@github.com/wswag/comark-composer.git#vX.Y.Z
```

`prepare` builds `dist/` when npm installs the package from Git, so generated files do not need to be committed. CI installs the checked-out repository into a clean consumer project and imports the public API. Releases create fixed Git tags; a public npm package is not required.

## Releases

Pull request titles must use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add resolver option`, `fix(http): handle missing content`, or `feat!: change the public API`. CI checks the title so every merged PR can be versioned automatically.

When a PR merges to `main`, the release workflow creates a GitHub Release with a matching `vX.Y.Z` tag. The first release uses the version already in `package.json`; later releases increment it and commit the version bump. `feat` produces a minor bump, other Conventional Commit types produce a patch bump, and `!` produces a major bump. This workflow does not publish to npm. Grant GitHub Actions permission to push to `main`; branch protection or rulesets must allow that bot commit.

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
import { createHttpRepository } from 'comark-composer/http'

const resolver = createContentResolver({
  repository: createHttpRepository({ baseUrl: '/content' }),
  fallbackLocales: ['en'],
})

const result = await resolver.resolve({ id: 'features', locale: 'de' })
// result.document is a Comark MarkdownDocument
// result.dependencies and result.diagnostics are separate from the document
```

`ContentRepository.load()` returns `null` only for a missing resource. Other errors propagate. Localized resources are tried in the requested locale and then in configured fallback order. Shared resources are loaded from `shared/` without fallback. The filesystem adapter maps IDs to `<root>/<locale>/<id>.md` and `<root>/shared/<id>.md`, rejects traversal, and checks symlink targets against the content root.

### Resolution timing and Go `embed`

Creating a resolver does not load content. Every `await resolver.resolve({ id, locale })` call loads the root document and then its layouts and includes on demand. The resolver does not cache responses; callers can cache at the repository or HTTP layer. Resolution state stays local to each call, so one resolver can serve concurrent locales.

For an application that embeds content in a Go binary, mount the embedded `content/` directory under matching HTTP routes:

```go
import (
    "embed"
    "io/fs"
    "log"
    "net/http"
)

//go:embed content
var embeddedContent embed.FS

contentFS, err := fs.Sub(embeddedContent, "content")
if err != nil {
    log.Fatal(err)
}
mux.Handle("/content/", http.StripPrefix("/content/", http.FileServer(http.FS(contentFS))))
```

The example route shape is `GET /content/{locale}/{id}.md` for localized resources and `GET /content/shared/{id}.md` for shared resources. The adapter does not reserve or add an `/api` prefix; set `baseUrl` or `urlFor` to match the routes your application already uses. Return HTTP 404 only when the resource is absent. The HTTP adapter maps 404 to `null`, forwards response text and ETag/Last-Modified as the optional revision, and throws on other HTTP failures. Use `headers` or `credentials` for authenticated endpoints.

`comark-composer/filesystem` remains available for Node.js applications and local tooling. It is not required when the application serves embedded content over HTTP.

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
