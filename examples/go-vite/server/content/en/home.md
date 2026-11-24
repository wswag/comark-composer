---
layout: shared/home
title: Hello world
---
::fragment{name="body"}
::p{class="eyebrow"}
COMARK COMPOSER · GO + VITE
::

# Hello world.

::p{class="lead"}
Your content comes from Markdown, is embedded in Go, and is composed in the browser with Comark.
::

## A small, complete pipeline

1. Go serves the Vite application and embedded Markdown files.
2. `comark-composer` loads layouts and fragments over HTTP.
3. Comark renders the finished document as HTML.
::
