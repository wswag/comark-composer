# Go + Vite + Comark hello world

This example follows one document from embedded Markdown to rendered HTML:

1. Go embeds `server/content/` and the production Vite build in the executable.
2. The language switch requests `de/home` or `en/home` through `/content/{locale}/home.md`.
3. The resolver loads the selected locale and shared layout from Go over HTTP.
4. `@comark/html` renders the resolved Comark `MarkdownDocument` into the page.

## Development

Requires Go 1.22+ and Node.js 20.19+.

```sh
npm install
```

Start the Go content server in one terminal:

```sh
go run ./server
```

Start Vite in another terminal:

```sh
npm run dev
```

Open the local URL printed by Vite. Vite serves the frontend and proxies `/content` to Go.

## Build a self-contained Go binary

```sh
npm run build
go build -o comark-example ./server
./comark-example
```

Open <http://localhost:8080>. The Go binary embeds both the frontend build and the Markdown source files; the resolver loads content on demand through HTTP requests served by that binary.
