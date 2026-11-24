# Technische Vorprüfung

Ergebnisse aus Implementierungsschritt 1 in Kapitel 9 des Konzepts.

## Template und Comark

- Das Projektgerüst basiert auf [`comarkdown/comark-plugin-template`](https://github.com/comarkdown/comark-plugin-template): ESM, TypeScript, tsdown mit Declaration-Ausgabe, Vitest, Playground und GitHub Actions.
- Verifizierte Entwicklungsbasis und unterstützte Peer-Range: `comark` `>=0.7.0 <0.8.0`. Die native API ist `parseMarkdown(source, options)`, die `MarkdownDocument` mit `nodes`, `frontmatter` und `meta` liefert.
- AST-Elemente sind `[tag, attributes, ...children]`; Text ist ein String; Kommentare haben `null` als Tag. Comark generiert Überschriften-IDs beim Parsen.
- Der offizielle Plugin-Vertrag hat Parser-Hooks (`pre` und `post`). `pre` arbeitet synchron am Markdowntext; `post` transformiert den gebauten AST. Die Ressourcenbeschaffung dieses Pakets ist asynchron und benötigt Kontext pro Resolve-Aufruf. Deshalb ist `createContentResolver()` die öffentliche Fassade. Die Kompositionslogik wird nicht parallel als synchroner Hook dupliziert.

## Spike und AST-Beispiel

Ausführbarer Spike (auch über `test/resolver.test.ts` abgedeckt):

```ts
import { parseMarkdown } from 'comark'

const document = await parseMarkdown(`---
id: sample
---
::fragment{name="intro"}
# Hello
::
::include{fragment="intro"}::`)

console.log(document.frontmatter.id) // sample
console.log(document.nodes)
// [ ['fragment', { name: 'intro' }, ['h1', { id: 'hello' }, 'Hello']],
//   ['include', { fragment: 'intro' }] ]
```

Die Direktiven sind native Comark-Komponenten und benötigen keinen eigenen Markdown-Parser. Der Resolver entfernt ihre AST-Knoten vor der Rückgabe. Nach AST-Komposition wird das Resultat mit `renderMarkdown` und `parseMarkdown` erneut durch Comark geführt, damit Überschriften-IDs und Dokumentmetadaten auf dem Gesamtdokument berechnet werden.

## Prüfung von `comark-include`

Die [`comark-include`-Dokumentation](https://comark-ui.onmax.me/include/) beschreibt eine synchrone, vor dem Parsing stattfindende Einfügung von Dateien. Sie unterstützt relative Dateipfade, Regions-/Zeilenbereiche, Reader-Callbacks und Zyklenprüfung. Die Semantik hier adressiert dagegen Repository-IDs über Locale und Shared-Scope, lexikalisch geerbte Fragmente sowie Fallbacks. `comark-include` kann das ohne zweite Kontext-/Locale-Verarbeitung nicht vollständig erfüllen und wird daher nicht als Laufzeitabhängigkeit verwendet.

## Distribution

Das Template erzeugt ESM und `.d.ts` in `dist/`. Der Kern verwendet Comark als Peer-Dependency; der Node-spezifische Dateisystemadapter hat einen eigenen Export unter `comark-composer/filesystem`. Für Git-Installationen baut `prepare` die ignorierten `dist/`-Dateien. Die CI installiert den Checkout über `git+file` in einem leeren Konsumentenprojekt und importiert die öffentliche API. Nach jedem PR-Merge auf `main` aktualisiert ein GitHub-Workflow die Paketversion und legt einen passenden `vX.Y.Z`-Tag mit GitHub Release an.

## HTTP-Repository für eingebettete Inhalte

Der Resolver lädt Ressourcen erst beim Aufruf von `resolve()`. `createHttpRepository()` implementiert denselben Repository-Vertrag für Browser- und Node-Fetch: standardmäßig `/{locale}/{id}.md` sowie `/shared/{id}.md` relativ zu `baseUrl`. HTTP 404 bedeutet `null`; andere HTTP-Fehler und Netzwerkfehler werden weitergegeben. `urlFor` kann das Standard-Routing ersetzen. Damit kann ein Go-Server Inhalte aus `embed.FS` ausliefern, während Comark und der Resolver im JavaScript-Client laufen. Der HTTP-Adapter hält keinen Cache; die Anwendung kann HTTP-Cache-Header oder einen Repository-Cache verwenden.
