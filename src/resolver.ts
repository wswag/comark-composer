import { parseMarkdown } from 'comark'
import { renderMarkdown } from 'comark/render'
import { CompositionError, resourceLabel } from './diagnostics.js'
import type {
  ContentRequest, ContentResolver, Diagnostic, ResourceKey, ResolvedContent,
  ResolverOptions,
} from './types.js'

type Attrs = Record<string, unknown>
type Node = string | [string | null, Attrs, ...unknown[]]
type Parsed = { nodes: Node[]; frontmatter?: Record<string, unknown>; meta?: Record<string, unknown>; [key: string]: unknown }
type ParsedContent = { parsed: Parsed; key: ResourceKey; locale: string; fragments: Map<string, Node[]> }

const DEFAULT_DEPTH = 32
const DEFAULT_EXPANSIONS = 1_000
const DEFAULT_NODES = 100_000

function isElement(node: Node): node is [string | null, Attrs, ...unknown[]] {
  return Array.isArray(node)
}

function children(node: Node): Node[] {
  return isElement(node) ? node.slice(2) as Node[] : []
}

function cloneNode(node: Node): Node {
  if (typeof node === 'string') return node
  return [node[0], structuredClone(node[1]), ...node.slice(2).map(child => cloneNode(child as Node))]
}

function textOnly(nodes: Node[]): boolean {
  return nodes.every(node => typeof node === 'string' ? node.trim() === '' : node[0] === null)
}

function validateId(id: string): void {
  if (!id || id.includes('\\') || id.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(id) || id.split('/').some(part => part === '..' || part === '' || part === '.')) {
    throw new CompositionError('INVALID_RESOURCE_ID', `Ungültige Ressourcen-ID: ${id}`)
  }
}

function attr(node: Node, name: string): string | undefined {
  if (!isElement(node)) return undefined
  const value = node[1][name]
  return typeof value === 'string' ? value : undefined
}

function marker(node: Node, name: string): boolean {
  return isElement(node) && node[0] === name
}

function fragmentsOf(nodes: Node[], key: ResourceKey, locale: string): { body: Node[]; fragments: Map<string, Node[]> } {
  const fragments = new Map<string, Node[]>()
  const body: Node[] = []
  for (const node of nodes) {
    if (!marker(node, 'fragment')) {
      body.push(node)
      continue
    }
    const name = attr(node, 'name')
    if (!name || !/^[\w.-]+$/.test(name)) throw new CompositionError('INVALID_FRAGMENT', 'Fragment benötigt ein gültiges name-Attribut.', key, locale)
    const unknownAttrs = Object.keys(node[1]).filter(attribute => attribute !== 'name' && attribute !== '$')
    if (unknownAttrs.length) throw new CompositionError('INVALID_FRAGMENT_ATTRIBUTE', `Unbekannte fragment-Attribute: ${unknownAttrs.join(', ')}`, key, locale)
    if (fragments.has(name)) throw new CompositionError('DUPLICATE_FRAGMENT', `Fragment "${name}" ist mehrfach definiert.`, key, locale)
    fragments.set(name, children(node))
  }
  return { body, fragments }
}

export function createContentResolver(options: ResolverOptions): ContentResolver {
  const fallbackLocales = options.fallbackLocales ?? []
  const maxDepth = options.maxDepth ?? DEFAULT_DEPTH
  const maxExpansions = options.maxExpansions ?? DEFAULT_EXPANSIONS
  const maxOutputNodes = options.maxOutputNodes ?? DEFAULT_NODES

  return {
    async resolve(request: ContentRequest): Promise<ResolvedContent> {
      validateId(request.id)
      if (!request.locale) throw new CompositionError('INVALID_LOCALE', 'Die angeforderte Locale darf nicht leer sein.')
      const dependencies: ResourceKey[] = []
      const diagnostics: Diagnostic[] = []
      const active: string[] = []
      const activeFragments: string[] = []
      const usedFragments = new Set<string>()
      const fragmentOwners = new WeakMap<Map<string, Node[]>, ResourceKey>()
      const declaredFragments = new Map<string, { name: string; key: ResourceKey; locale: string }>()
      let expansions = 0
      let needsFinalParse = false
      const countNodes = (nodes: Node[]): number => nodes.reduce((sum, node) => sum + 1 + (isElement(node) ? countNodes(children(node)) : 0), 0)

      const load = async (id: string, locale: string, shared = false): Promise<ParsedContent> => {
        validateId(id)
        if (!shared) validateId(locale)
        const tries = shared ? [locale] : [locale, ...fallbackLocales.filter(item => item !== locale)]
        for (const candidate of tries) {
          const key: ResourceKey = shared ? { scope: 'shared', id } : { scope: 'localized', id, locale: candidate }
          const source = await options.repository.load(key)
          if (!source) continue
          if (!dependencies.some(dep => resourceLabel(dep) === resourceLabel(key))) dependencies.push(key)
          let parsed: Parsed
          try {
            parsed = await parseMarkdown(source.text, options.parserOptions as Parameters<typeof parseMarkdown>[1]) as unknown as Parsed
          } catch (cause) {
            throw new CompositionError('PARSE_ERROR', `Comark konnte ${resourceLabel(key)} nicht parsen: ${String(cause)}`, key, candidate, [...active])
          }
          const extracted = fragmentsOf(parsed.nodes ?? [], key, candidate)
          if (shared && extracted.fragments.size) throw new CompositionError('SHARED_FRAGMENTS', 'Gemeinsame Ressourcen dürfen keine Fragmente deklarieren.', key, candidate, [...active])
          fragmentOwners.set(extracted.fragments, key)
          for (const name of extracted.fragments.keys()) declaredFragments.set(`${resourceLabel(key)}:${name}`, { name, key, locale: candidate })
          if (!shared && candidate !== locale) diagnostics.push({ code: 'LOCALE_FALLBACK', severity: 'warning', message: `${resourceLabel(key)} wurde als Fallback verwendet.`, resource: key, locale: candidate, chain: [...active] })
          return { parsed: { ...parsed, nodes: extracted.body }, key, locale: candidate, fragments: extracted.fragments }
        }
        throw new CompositionError('RESOURCE_NOT_FOUND', `Ressource "${id}" wurde in ${shared ? 'shared' : `Locale ${locale}`} nicht gefunden.`, shared ? { scope: 'shared', id } : { scope: 'localized', id, locale }, locale, [...active])
      }

      const expand = async (content: ParsedContent, inherited?: Map<string, Node[]>, depth = 0): Promise<Node[]> => {
        if (depth > maxDepth) throw new CompositionError('MAX_DEPTH', `Maximale Kompositionstiefe (${maxDepth}) überschritten.`, content.key, content.locale, [...active])
        const markerKey = `${resourceLabel(content.key)}@${content.locale}`
        if (active.includes(markerKey)) throw new CompositionError('INCLUDE_CYCLE', `Zyklus erkannt: ${[...active, markerKey].join(' → ')}`, content.key, content.locale, [...active, markerKey])
        active.push(markerKey)
        try {
          const frontmatter = content.parsed.frontmatter ?? {}
          let nodes = content.parsed.nodes
          let context = content.fragments.size ? content.fragments : inherited
          if (content.fragments.size && content.key.scope === 'shared') throw new CompositionError('SHARED_FRAGMENTS', 'Gemeinsame Ressourcen dürfen keine Fragmente deklarieren.', content.key, content.locale)

          const layout = frontmatter.layout
          if (layout !== undefined) {
            needsFinalParse = true
            if (typeof layout !== 'string' || !layout.startsWith('shared/') || !layout.slice('shared/'.length)) throw new CompositionError('INVALID_LAYOUT', 'layout muss eine ID im Format "shared/<id>" sein.', content.key, content.locale)
            if (!textOnly(nodes)) throw new CompositionError('LAYOUT_BODY_CONTENT', 'Ein Dokument mit Layout darf außerhalb von Fragmentdeklarationen keinen Inhalt enthalten.', content.key, content.locale)
            const layoutContent = await load(layout.slice('shared/'.length), content.locale, true)
            if (layoutContent.parsed.frontmatter?.layout !== undefined) throw new CompositionError('NESTED_LAYOUT', 'Layouts dürfen kein eigenes layout deklarieren.', layoutContent.key, layoutContent.locale, [...active])
            nodes = await expand(layoutContent, context, depth + 1)
          }

          const resolveNodes = async (sourceNodes: Node[], fragmentContext: Map<string, Node[]> | undefined): Promise<Node[]> => {
            const result: Node[] = []
            for (const node of sourceNodes) {
              if (!marker(node, 'include')) {
                if (isElement(node) && node[0] !== null) {
                  const nested = await resolveNodes(children(node), fragmentContext)
                  result.push([node[0], structuredClone(node[1]), ...nested])
                } else result.push(cloneNode(node))
                continue
              }
              if (children(node).some(child => typeof child !== 'string' || child.trim() !== '')) throw new CompositionError('INVALID_INCLUDE_BODY', 'include-Direktiven dürfen keinen eigenen Blockinhalt enthalten.', content.key, content.locale, [...active])
              const unknownAttrs = Object.keys(node[1]).filter(key => key !== 'src' && key !== 'fragment' && key !== '$')
              if (unknownAttrs.length) throw new CompositionError('INVALID_INCLUDE_ATTRIBUTE', `Unbekannte include-Attribute: ${unknownAttrs.join(', ')}`, content.key, content.locale, [...active])
              expansions++
              needsFinalParse = true
              if (expansions > maxExpansions) throw new CompositionError('MAX_EXPANSIONS', `Maximale Include-Anzahl (${maxExpansions}) überschritten.`, content.key, content.locale, [...active])
              const src = attr(node, 'src')
              const fragment = attr(node, 'fragment')
              if (isElement(node) && 'src' in node[1] && !src) throw new CompositionError('INVALID_INCLUDE_ATTRIBUTE', 'src darf nicht leer sein.', content.key, content.locale, [...active])
              if (isElement(node) && 'fragment' in node[1] && !fragment) throw new CompositionError('INVALID_INCLUDE_ATTRIBUTE', 'fragment darf nicht leer sein.', content.key, content.locale, [...active])
              if (!src && !fragment) throw new CompositionError('INVALID_INCLUDE', 'include benötigt src oder fragment.', content.key, content.locale, [...active])
              if (fragment && !/^[\w.-]+$/.test(fragment)) throw new CompositionError('INVALID_INCLUDE_ATTRIBUTE', 'fragment muss einen gültigen Fragmentnamen enthalten.', content.key, content.locale, [...active])
              if (src && src.startsWith('shared/')) {
                const target = await load(src.slice('shared/'.length), content.locale, true)
                if (fragment) {
                  const found = target.fragments.get(fragment)
                  if (!found) throw new CompositionError('FRAGMENT_NOT_FOUND', `Fragment "${fragment}" fehlt in ${src}.`, target.key, target.locale, [...active])
                  usedFragments.add(`${resourceLabel(target.key)}:${fragment}`)
                  result.push(...await resolveNodes(found, target.fragments))
                } else result.push(...await expand(target, context, depth + 1))
              } else if (src) {
                const target = await load(src, content.locale)
                if (fragment) {
                  const found = target.fragments.get(fragment)
                  if (!found) throw new CompositionError('FRAGMENT_NOT_FOUND', `Fragment "${fragment}" fehlt in ${src} (${target.locale}).`, target.key, target.locale, [...active])
                  usedFragments.add(`${resourceLabel(target.key)}:${fragment}`)
                  result.push(...await resolveNodes(found, target.fragments))
                } else result.push(...await expand(target, undefined, depth + 1))
              } else {
                const found = fragmentContext?.get(fragment!)
                if (!found) throw new CompositionError('FRAGMENT_NOT_FOUND', `Fragment "${fragment}" fehlt im aktuellen Fragmentkontext.`, content.key, content.locale, [...active])
                const owner = fragmentContext ? fragmentOwners.get(fragmentContext) : undefined
                const fragmentKey = `${owner ? resourceLabel(owner) : resourceLabel(content.key)}#${fragment}`
                if (activeFragments.includes(fragmentKey)) throw new CompositionError('INCLUDE_CYCLE', `Fragmentzyklus erkannt: ${[...activeFragments, fragmentKey].join(' → ')}`, content.key, content.locale, [...active, ...activeFragments, fragmentKey])
                activeFragments.push(fragmentKey)
                if (owner) usedFragments.add(`${resourceLabel(owner)}:${fragment}`)
                try {
                  result.push(...await resolveNodes(found, fragmentContext))
                } finally {
                  activeFragments.pop()
                }
              }
            }
            return result
          }
          const result = await resolveNodes(nodes, context)
          return result
        } finally {
          active.pop()
        }
      }

      const root = await load(request.id, request.locale)
      if (root.fragments.size) needsFinalParse = true
      const body = await expand(root)
      const nodeCount = countNodes(body)
      if (nodeCount > maxOutputNodes) throw new CompositionError('MAX_OUTPUT_NODES', `Maximale Ausgabegröße (${maxOutputNodes} AST-Knoten) überschritten.`, root.key, root.locale, [...active])
      const assertNoMarkers = (nodes: Node[]): void => {
        for (const node of nodes) {
          if (marker(node, 'fragment') || marker(node, 'include')) throw new CompositionError('UNRESOLVED_MARKER', `Kompositionsmarker "${isElement(node) ? node[0] : ''}" ist im Ergebnis verblieben.`, root.key, root.locale)
          if (isElement(node)) assertNoMarkers(children(node))
        }
      }
      assertNoMarkers(body)
      for (const fragment of declaredFragments.values()) {
        if (!usedFragments.has(`${resourceLabel(fragment.key)}:${fragment.name}`)) diagnostics.push({
          code: 'UNUSED_FRAGMENT', severity: options.unusedFragmentsAsErrors ? 'error' : 'warning',
          message: `Fragment "${fragment.name}" wird nicht verwendet.`, resource: fragment.key, locale: fragment.locale,
        })
      }
      // Round-trip the composed AST through Comark so document-level metadata
      // and heading IDs are calculated once over the final document.
      let document: ResolvedContent['document']
      if (needsFinalParse) {
        try {
          const composedMarkdown = await renderMarkdown({ nodes: body, frontmatter: root.parsed.frontmatter ?? {}, meta: {} } as Parameters<typeof renderMarkdown>[0])
          document = await parseMarkdown(composedMarkdown, options.parserOptions as Parameters<typeof parseMarkdown>[1])
        } catch (cause) {
          throw new CompositionError('FINAL_PARSE_ERROR', `Comark konnte das zusammengesetzte Dokument nicht finalisieren: ${String(cause)}`, root.key, root.locale, [...dependencies.map(resourceLabel)])
        }
      } else document = root.parsed as unknown as ResolvedContent['document']
      return { id: request.id, requestedLocale: request.locale, locale: root.locale, document, dependencies, diagnostics }
    },
  }
}
