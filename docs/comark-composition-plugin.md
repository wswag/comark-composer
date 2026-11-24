# Comark Composer
## Technisches Konzept und Implementierungsspezifikation

**Status:** Entwurf zur Implementierung · **Version:** 0.1

## 1. Zielsetzung

Das Plugin erweitert Comark um deklarative Dokumentenkomposition und sprachabhängige Inhaltsauflösung. Gemeinsame Layouts sollen genau einmal definiert und mit lokalisierten Markdown-Fragmenten kombiniert werden können. Eigenständige lokalisierte Dokumente und gemischte Seiten bleiben ausdrücklich zulässig.

Das Ergebnis ist ein natives, vollständig aufgelöstes und JSON-serialisierbares Comark-Dokument. Das Paket ist frameworkunabhängig und besitzt keine Abhängigkeit von Vue, Tailwind, SSR-Frameworks oder einer konkreten Anwendung.

**Leitprinzip:** Redundanzfreiheit als Möglichkeit, nicht als Zwang. Das Plugin interpretiert Komposition, nicht Gestaltung.

## 2. Abgrenzung und technische Vorprüfung

Comark bleibt für Parsing, AST-Format und Rendering zuständig. Das bestehende Projekt `comark-include` (https://comark-ui.onmax.me/include/) ist ein Kandidat für dateibasierte Includes und Regionen. Seine tatsächliche API, Lizenz, Plugin-Hooks, Auflösungsreihenfolge und Erweiterbarkeit sind vor Implementierung anhand des Quellcodes zu prüfen. Die bisher diskutierten API-Beispiele sind keine verifizierten Versionsverträge.

Vor dem ersten Implementierungsschritt:

1. Unterstützte Comark-Version festlegen und native Dokumenttypen, Parser, Plugin-Hooks und AST-Traversierung verifizieren (https://comark.dev/).
2. Mit einem ausführbaren Spike prüfen, wie Blockdirektiven, Attribute, Slots und Frontmatter im AST repräsentiert werden.
3. `comark-include` darauf prüfen, ob eigene Loader, kontextabhängige Regionen und verschachtelte Includes ohne Verlust des Aufrufkontexts möglich sind.
4. Wiederverwendung bevorzugen, sofern die unten spezifizierte Semantik damit vollständig und ohne doppelte Verarbeitung umsetzbar ist. Andernfalls eine kleine eigene Kompositionsimplementierung erstellen; keinen Markdown-Parser entwickeln.
5. Prüfen, ob Comark eine geeignete Phase für AST-Transformation und abschließende Metadaten-/Heading-ID-Berechnung bietet. Falls nicht, einen öffentlichen Resolver-Wrapper statt eines erzwungenen Parser-Hooks verwenden. Das native Ausgabeformat bleibt unverändert.

Die folgenden Syntax- und API-Beispiele definieren den gewünschten Vertrag des neuen Pakets, nicht bereits vorhandene Comark-Funktionen.

## 3. Dokumentmodell

Logische Ressourcen werden über stabile, sprachunabhängige IDs adressiert. Eine mögliche Dateisystemabbildung lautet:

```text
content/
  shared/
    features.md
    pricing.md
  de/
    features.md
    pricing.md
    home.md
  en/
    features.md
    pricing.md
    home.md
```

Die Dateisystemstruktur ist Konvention eines Repository-Adapters, nicht Bestandteil des Kernalgorithmus. IDs sind keine öffentlichen URLs. Lokalisierte Slugs und SEO-Metadaten bleiben Anwendungsdaten im Frontmatter.

### 3.1 Eigenständige Dokumente

```md
---
id: home
title: Dein Wochenplan
---
# Dein Wochenplan

Ein eigenständiger Inhalt.
```

Ohne `layout` wird der Dokumentkörper direkt verwendet. Includes sind trotzdem zulässig.

### 3.2 Gemeinsames Layout und lokalisierte Fragmente

`de/features.md`:

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

::fragment{name="time"}
### Zeit sparen

Dein Wochenplan in Minuten.
::
```

`shared/features.md`:

Äußere Blockdelimiter sind länger als innere; die konkrete Syntax ist im Spike zu bestätigen.

```md
::::box{.feature-grid}

:::box{.prose .feature-card}
::include{fragment="intro"}
::
:::

:::box{.prose .feature-card}
::include{fragment="time"}
::
:::

::::
```

Die `fragment`- und `include`-Direktiven sind reine Kompositionsmarker. Sie werden vor dem Rendering entfernt. Fragmentkinder werden als Knotenfolge eingefügt, ohne zusätzliche Wrapper oder Vue-Komponenten.

### 3.3 Hybride Komposition innerhalb einer Seite

```md
# Individueller Seiteneinstieg

::include{src="shared/pricing"}
::

## Individueller Abschluss
```

Ein Include eines gemeinsamen Layouts kann auf die Fragmente des aufrufenden Dokuments zugreifen. Ein eigenständiges Dokument darf dafür zusätzlich benannte Fragmente deklarieren; diese erscheinen ausschließlich an ihren Einfügepositionen. Gemeinsame Abschnitte können auch sprachabhängige Ressourcen referenzieren.

### 3.4 Dateibasierte Referenzen

```md
::include{src="features" fragment="time"}
::
```

`src="features"` bezeichnet eine lokalisierte Ressource; `src="shared/features"` eine explizit sprachunabhängige Ressource. Ohne `src` bezeichnet `fragment` eine lokale, kontextbezogene Fragmentreferenz. Ohne `fragment` wird der vollständige aufgelöste Dokumentkörper der Zielressource eingefügt. Mindestens eines der Attribute ist erforderlich.

Für v0.1 werden ausschließlich Block-Includes unterstützt. Inline-Includes mit Blockinhalten könnten ungültiges HTML erzeugen und sind daher nicht Bestandteil des Vertrags. Eine mögliche native `region`-Syntax von comark-include wird nur nach technischer Prüfung als kompatible Erweiterung übernommen; `fragment` ist die kanonische Syntax dieses Konzepts.

## 4. Auflösungssemantik

### 4.1 Kontext und Gültigkeitsbereiche

Jede Auflösung besitzt eine angeforderte Locale, eine tatsächlich ausgewählte Ressourcen-Locale und einen lexikalischen Fragmentkontext. Fragmente sind pro Dokument eindeutig. Ein gemeinsames Layout übernimmt den Fragmentkontext seines Aufrufers. Ein Include einer lokalisierten Ressource eröffnet dagegen einen eigenen Kontext für deren Fragmente. Nach Rückkehr gilt wieder der vorherige Kontext. Keine implizite globale Fragmentregistrierung.

Gemeinsame Ressourcen dürfen selbst lokale Fragmente definieren; zur Vermeidung mehrdeutiger Namensauflösung wird dies in v0.1 untersagt. Sie konsumieren ausschließlich den geerbten Kontext oder explizit referenzierte Ressourcen.

### 4.2 Sprachauflösung

- Die Locale wird explizit durch den Aufrufer gesetzt; keine automatische Browser- oder HTTP-Spracherkennung.
- Lokalisierte Ressourcen werden zunächst in der angeforderten Locale gesucht.
- Optional konfigurierte Fallback-Locales werden in definierter Reihenfolge geprüft, ausschließlich wenn die Ressource fehlt. Parser-, Zugriffs- und Validierungsfehler lösen keinen Fallback aus.
- Gemeinsame Ressourcen besitzen keine Locale und werden ohne Fallback geladen.
- Fehlende Fragmente einer vorhandenen Sprachversion sind standardmäßig Fehler. Kein stilles Mischen einzelner Übersetzungsfragmente.
- Wird das Wurzeldokument per Fallback geladen, gilt dessen tatsächliche Locale als effektive Locale für weitere lokalisierte Includes. Bei einem Fallback eines eingebundenen Dokuments gilt dessen Locale nur in seinem Teilbaum.
- Jede Fallback-Nutzung wird in den Diagnosen und Abhängigkeiten ausgewiesen. Standardmäßig sind Fallbacks deaktiviert; die Anwendung entscheidet über deren Zulässigkeit und SEO-Auswirkungen.

### 4.3 Layoutvererbung

`layout` im Frontmatter eines lokalisierten Dokuments referenziert genau eine gemeinsame Ressource. Das Layout bestimmt den resultierenden Dokumentkörper; das Frontmatter des lokalisierten Dokuments bleibt maßgeblich. Layout-Metadaten werden nicht implizit zusammengeführt.

Bei einem Dokument mit Layout sind außerhalb der Fragmentdeklarationen keine freien Inhaltsknoten zulässig (außer bedeutungslosen Leerraum-/Kommentarknoten). So wird versehentlicher Inhaltsverlust verhindert. Layouts mit eigener Layoutvererbung sind in v0.1 nicht zulässig. Verschachtelte gemeinsame Abschnitte werden stattdessen über Includes realisiert.

### 4.4 Reihenfolge

1. Wurzeldokument laden, Locale bestimmen und Frontmatter sowie Körper parsen.
2. Fragmentdeklarationen sammeln und validieren; aus dem direkt renderbaren Körper entfernen.
3. Optional gemeinsames Layout laden und dessen Körper als Kompositionsbasis wählen.
4. Includes rekursiv im jeweiligen Kontext auflösen; Fragmentknoten als unabhängige Kopien einsetzen.
5. Kompositionsmarker, ungültige Referenzen und Layoutverträge abschließend prüfen.
6. Native Comark-Metadaten, Überschriften-IDs und gegebenenfalls Inhaltsverzeichnis für das zusammengesetzte Dokument konsistent erzeugen. Keine veralteten Metadaten aus Teilbäumen übernehmen.
7. Natives Comark-Dokument und separate Auflösungsdiagnosen zurückgeben.

Die konkrete technische Phase (Quelltext- oder AST-Transformation) wird nach dem Spike gewählt. AST-Komposition ist bevorzugt, sofern alle nativen Parser-Postprocessing-Schritte korrekt auf das Enddokument angewendet werden können. Bei Quelltextkomposition muss insbesondere die Verschachtelung von Blockdelimitern korrekt bleiben. Keine Regex-basierte Nachimplementierung der Markdown-Grammatik.

## 5. Öffentliche Schnittstelle

Vorgeschlagener TypeScript-Vertrag (Namen und native Comark-Typimporte nach Vorprüfung konkretisieren):

```ts
interface ContentRequest {
  id: string
  locale: string
}

type ResourceKey =
  | { scope: 'localized'; id: string; locale: string }
  | { scope: 'shared'; id: string }

interface ContentSource {
  text: string
  revision?: string
}

interface ContentRepository {
  load(key: ResourceKey): Promise<ContentSource | null>
}

interface ResolverOptions {
  repository: ContentRepository
  fallbackLocales?: readonly string[]
  maxDepth?: number
  maxExpansions?: number
  maxOutputNodes?: number
}

interface ResolvedContent {
  id: string
  requestedLocale: string
  locale: string
  document: MarkdownDocument // nativer Comark-Typ
  dependencies: ResourceKey[]
  diagnostics: Diagnostic[]
}
```

```ts
const resolver = createContentResolver({ repository })
const result = await resolver.resolve({ id: 'features', locale: 'de' })
```

`null` bedeutet ausschließlich nicht vorhanden. Andere Repository-Fehler werden weitergegeben. Die Implementierung ist asynchron, zustandsisoliert pro Aufruf und parallel nutzbar. Parseroptionen bzw. Plugin-Konfiguration müssen durchreichbar sein, ohne interne Kompositionsmarker an den Renderer auszuliefern.

Falls ein nativer Comark-Plugin-Hook geeignet ist, wird zusätzlich eine Plugin-Factory angeboten. Der Resolver-Aufruf bleibt die stabile, frameworkunabhängige Fassade für die Beschaffung eines Wurzeldokuments. Keine zwei unabhängigen Implementierungen der Kompositionslogik.

## 6. Validierung und Sicherheit

- Doppelte Fragmentnamen, fehlende referenzierte Fragmente, ungültige Attribute, unbekannte Layouts und nicht aufgelöste Marker sind Fehler.
- Nicht verwendete Fragmente sind Warnungen; optional im CI als Fehler behandelbar.
- Zyklen über Dokumente, Layouts und Fragmente werden über einen aktiven Auflösungsstack erkannt. Identität umfasst Ressource, effektive Locale und Fragmentkontext; wiederholte nicht rekursive Includes bleiben erlaubt.
- Fehler enthalten stabilen Fehlercode, Ressourcen-ID, Locale und Referenzkette; Quellposition soweit Comark sie liefert. Keine stillen leeren Ersetzungen.
- Begrenzung von Rekursionstiefe, Anzahl Expansionen und Ausgabegröße. Vorgeschlagene Defaults: 32 Ebenen, 1000 Expansionen, 100000 AST-Knoten; konfigurierbar und getestet.
- Ressourcen-IDs validieren; keine absoluten Pfade, URL-Schemas, `..`-Segmente oder unkontrollierten Dateizugriffe. Dateisystemadapter muss auch Symlink-Ausbrüche aus dem Root verhindern.
- Keine Ausführung von JavaScript oder Template-Ausdrücken durch den Resolver. Comark-Bindings werden unverändert durchgereicht, nicht als Übersetzungsmechanismus interpretiert. Sanitizing und Komponenten-Allowlist bleiben Verantwortung der Anwendung.
- AST-Kopien dürfen keine Mutation gecachter Quelldokumente oder Zustandsübertragung zwischen Aufrufen verursachen.

## 7. Paketierung und Distribution

Eigenständiges Git-Repository, beispielsweise `comark-composer`. TypeScript, ESM, npm, native Comark-Typen. Comark als kompatibel versionierte Peer-Dependency und für Entwicklung/Tests als Dev-Dependency. Keine Vue-Abhängigkeit.

```text
src/
  index.ts
  resolver.ts
  composition.ts
  repository.ts
  diagnostics.ts
  types.ts
  adapters/filesystem.ts
tests/
  fixtures/
  unit/
  integration/
```

Der Dateisystemadapter wird als separater Node-spezifischer Export angeboten; der Kern bleibt unabhängig von Node-Dateisystem-APIs. Build mit TypeScript oder einem geeigneten Library-Bundler; JavaScript und `.d.ts` unter `dist/`, explizite `exports`, reproduzierbare Tests und Lockfile.

Git-basierte Distribution mit festen Release-Tags, beispielsweise:

```sh
npm install git+ssh://git@github.com/wswag/comark-composer.git#v0.1.0
```

Für Git-Installation muss der Build verfügbar sein: entweder versionierte Release-Artefakte im Git-Tag oder ein getesteter `prepare`-Build bei Installation. Eine Strategie verbindlich auswählen und in CI durch Installation in ein leeres Konsumentenprojekt prüfen. Keine öffentliche npm-Veröffentlichung erforderlich. Keine Zugangsdaten im Repository.

## 8. Test- und Abnahmekriterien

| Testfall | Erwartung |
|---|---|
| Eigenständiges Dokument | Natives Comark-Ergebnis ohne Kompositionsänderungen |
| Gemeinsames Layout DE/EN | Identische Layoutknoten und Klassen, unterschiedliche Texte |
| Vollständige Markdown-Fragmente | Überschriften, Listen, Links, Komponenten und Slots bleiben erhalten |
| Hybride Seite | Freier Inhalt und gemeinsame Abschnitte in korrekter Reihenfolge |
| Explizites Ressourcenfragment | Richtige Quelle und Locale |
| Verschachtelte Includes | Lexikalischer Kontext bleibt korrekt |
| Wiederholtes Include | Erlaubt; keine gemeinsam mutierten Knoten |
| Fehlende Locale | Definierter Fallback oder Fehler |
| Fehlendes Fragment | Fehler statt stiller Sprachmischung |
| Doppelte Fragmentnamen | Validierungsfehler |
| Direkte und indirekte Zyklen | Fehler mit Referenzkette |
| Überschriften-ID-Kollision | Konsistente eindeutige IDs im Enddokument gemäß Comark-Verhalten |
| Frontmatter | Lokalisierte Metadaten bleiben maßgeblich |
| Ungültige Pfade und Limits | Kontrollierter Fehler |
| Parallele Aufrufe | Keine Vermischung von Locale oder Kontext |
| JSON-Roundtrip | Dokument bleibt renderbar und strukturell gleichwertig |
| Git-Installation | Paket und Typen in separatem Projekt nutzbar |

Zusätzlich ein Integrationstest mit dem nativen Comark-Renderer für vorgeparste Dokumente. SSR/Hydration kann in einem separaten Test-Fixture geprüft werden; Vue bleibt dabei reine Testabhängigkeit und nicht Teil der Paket-Runtime. Die tatsächliche Renderer-API ist versionsbezogen zu verifizieren.

## 9. Implementierungsreihenfolge für Codex

0. Basis des Projekts soll das Plugin-Template für Comark auf Github sein: github.com/comarkdown/comark-plugin-template - hierauf soll die beschriebene Funktion aufgebaut werden

1. Technische Vorprüfung mit dokumentierten Ergebnissen und minimalen ausführbaren Beispielen.
2. Paketgerüst, Repository-Vertrag, native Typintegration und eigenständige Dokumente.
3. Fragmentextraktion, kontextbezogene Includes und gemeinsame Layouts.
4. Explizite Ressourcenreferenzen, verschachtelte Komposition und Locale-Fallbacks.
5. Validierung, Sicherheitslimits, Diagnosen und vollständige Testmatrix.
6. Native Metadatenkonsistenz, JSON-Roundtrip und Renderer-Integration.
7. README mit Syntaxreferenz, API, Git-Installation, Versionskompatibilität und Fehlerbeispielen; Release-Tag nach erfolgreicher CI.

Keine Implementierung auf Basis angenommener Comark- oder comark-include-APIs. Abweichungen von der spezifizierten Semantik sind vor Umsetzung zu dokumentieren und abzustimmen. Bestehende Bibliotheksfunktionen nutzen, sofern sie den Vertrag erfüllen.

## 10. Nicht-Ziele und spätere Erweiterungen

Kein CMS, kein Übersetzungsdienst, kein Vue-i18n-Ersatz, kein Styling-System, keine HTTP-API, kein Routing, keine SEO-Generierung, keine SSR-State-Verwaltung und kein persistenter Cache. Das Paket liefert Abhängigkeiten und optionale Revisionen, damit Anwendungen eigenes Caching und Invalidierung implementieren können. Keine automatische Übersetzung oder Synchronisierung sprachabhängiger Layouts.

Später denkbar: CLI für Content-Validierung, zusätzliche Repository-Adapter, explizite Fragment-Fallbacks, Inline-Fragmente und Build-Integration. Diese Funktionen sind nicht Voraussetzung für v0.1.

## 11. Definition of Done

Die Implementierung erfüllt die dokumentierte Syntax und Semantik, besteht die Testmatrix, ist über einen festen Git-Tag installierbar und liefert ausschließlich native Comark-Dokumente ohne verbleibende Kompositionsmarker. Eine Anwendung kann eigenständige und gemeinsam komponierte lokalisierte Seiten über dieselbe Schnittstelle verarbeiten, ohne eigene Layout- oder Übersetzungslogik im Renderer zu implementieren.
