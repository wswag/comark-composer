import { parseMarkdown } from 'comark'
import { renderMarkdown } from 'comark/render'
import { CompositionError, resourceLabel } from './diagnostics.js'
import type {
  ContentRequest,
  ContentResolver,
  Diagnostic,
  ResourceKey,
  ResolvedContent,
  ResolverOptions,
} from './types.js'

type Attributes = Record<string, unknown>
type CompositionNode = string | [string | null, Attributes, ...unknown[]]
type ParsedDocument = {
  nodes: CompositionNode[]
  frontmatter?: Record<string, unknown>
  meta?: Record<string, unknown>
  [key: string]: unknown
}

interface ParsedResource {
  key: ResourceKey
  locale: string
  document: ParsedDocument
  fragments: Map<string, CompositionNode[]>
}

interface FragmentScope {
  key: ResourceKey
  locale: string
  fragments: Map<string, CompositionNode[]>
}

const DEFAULT_MAX_DEPTH = 32
const DEFAULT_MAX_EXPANSIONS = 1_000
const DEFAULT_MAX_OUTPUT_NODES = 100_000
const SHARED_RESOURCE_PREFIX = 'shared/'

/** isElement reports whether a Comark node is an element or comment tuple. */
function isElement(node: CompositionNode): node is [string | null, Attributes, ...unknown[]] {
  return Array.isArray(node)
}

/** children returns the child nodes of a Comark element. */
function children(node: CompositionNode): CompositionNode[] {
  return isElement(node) ? (node.slice(2) as CompositionNode[]) : []
}

/** cloneNode copies a Comark subtree before the resolver inserts it elsewhere. */
function cloneNode(node: CompositionNode): CompositionNode {
  if (typeof node === 'string') return node

  return [
    node[0],
    structuredClone(node[1]),
    ...node.slice(2).map(child => cloneNode(child as CompositionNode)),
  ]
}

/** isWhitespaceOrComment reports whether layout content is semantically empty. */
function isWhitespaceOrComment(nodes: CompositionNode[]): boolean {
  return nodes.every(node => {
    if (typeof node === 'string') return node.trim() === ''
    return node[0] === null
  })
}

/** validateResourceId rejects IDs that could escape or reinterpret a repository path. */
function validateResourceId(id: string): void {
  const hasInvalidSegment = id.split('/').some(segment =>
    segment === '' || segment === '.' || segment === '..',
  )

  if (
    !id ||
    id.includes('\\') ||
    id.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(id) ||
    hasInvalidSegment
  ) {
    throw new CompositionError('INVALID_RESOURCE_ID', `Ungültige Ressourcen-ID: ${id}`)
  }
}

/** getStringAttribute returns a string attribute from a Comark element. */
function getStringAttribute(node: CompositionNode, name: string): string | undefined {
  if (!isElement(node)) return undefined

  const value = node[1][name]
  return typeof value === 'string' ? value : undefined
}

/** isMarker reports whether a node uses a reserved composition component name. */
function isMarker(node: CompositionNode, name: string): boolean {
  return isElement(node) && node[0] === name
}

/** extractFragments validates top-level declarations and separates them from the body. */
function extractFragments(
  nodes: CompositionNode[],
  key: ResourceKey,
  locale: string,
): { body: CompositionNode[]; fragments: Map<string, CompositionNode[]> } {
  const body: CompositionNode[] = []
  const fragments = new Map<string, CompositionNode[]>()

  // Collect declarations while preserving the ordinary document body.
  for (const node of nodes) {
    if (!isMarker(node, 'fragment')) {
      body.push(node)
      continue
    }

    const name = getStringAttribute(node, 'name')
    if (!name || !/^[\w.-]+$/.test(name)) {
      throw new CompositionError(
        'INVALID_FRAGMENT',
        'Fragment benötigt ein gültiges name-Attribut.',
        key,
        locale,
      )
    }

    const unknownAttributes = Object.keys(node[1]).filter(
      attribute => attribute !== 'name' && attribute !== '$',
    )
    if (unknownAttributes.length > 0) {
      throw new CompositionError(
        'INVALID_FRAGMENT_ATTRIBUTE',
        `Unbekannte fragment-Attribute: ${unknownAttributes.join(', ')}`,
        key,
        locale,
      )
    }

    if (fragments.has(name)) {
      throw new CompositionError(
        'DUPLICATE_FRAGMENT',
        `Fragment "${name}" ist mehrfach definiert.`,
        key,
        locale,
      )
    }

    fragments.set(name, children(node))
  }

  return { body, fragments }
}

/** ResolutionSession holds mutable state for one isolated resolve call. */
class ResolutionSession {
  private readonly fallbackLocales: readonly string[]
  private readonly maxDepth: number
  private readonly maxExpansions: number
  private readonly maxOutputNodes: number
  private readonly dependencies: ResourceKey[] = []
  private readonly diagnostics: Diagnostic[] = []
  private readonly activeResources: string[] = []
  private readonly activeFragments: string[] = []
  private readonly usedFragments = new Set<string>()
  private readonly declaredFragments = new Map<
    string,
    { name: string; key: ResourceKey; locale: string }
  >()
  private expansionCount = 0
  private needsFinalParse = false

  /** new ResolutionSession creates fresh state and applies default safety limits. */
  constructor(private readonly options: ResolverOptions) {
    this.fallbackLocales = options.fallbackLocales ?? []
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
    this.maxExpansions = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS
    this.maxOutputNodes = options.maxOutputNodes ?? DEFAULT_MAX_OUTPUT_NODES
  }

  /** resolve builds one localized Comark document and its resolution metadata. */
  async resolve(request: ContentRequest): Promise<ResolvedContent> {
    // Validate the request and load its root resource.
    validateResourceId(request.id)
    if (!request.locale) {
      throw new CompositionError('INVALID_LOCALE', 'Die angeforderte Locale darf nicht leer sein.')
    }

    const root = await this.loadResource(request.id, request.locale)
    if (root.fragments.size > 0) this.needsFinalParse = true

    // Expand the document and enforce output invariants.
    const body = await this.expandResource(root, undefined, 0)
    const outputNodeCount = this.countNodes(body)
    if (outputNodeCount > this.maxOutputNodes) {
      throw new CompositionError(
        'MAX_OUTPUT_NODES',
        `Maximale Ausgabegröße (${this.maxOutputNodes} AST-Knoten) überschritten.`,
        root.key,
        root.locale,
      )
    }
    this.assertNoCompositionMarkers(body, root)
    this.reportUnusedFragments()

    // Reparse composed content so Comark recalculates document metadata.
    const document = await this.buildDocument(root, body)

    return {
      id: request.id,
      requestedLocale: request.locale,
      locale: root.locale,
      document,
      dependencies: this.dependencies,
      diagnostics: this.diagnostics,
    }
  }

  /** loadResource selects a locale candidate, parses the source, and records fragments. */
  private async loadResource(
    id: string,
    locale: string,
    shared = false,
  ): Promise<ParsedResource> {
    // Validate the resource key and prepare locale candidates.
    validateResourceId(id)
    if (!shared) validateResourceId(locale)

    const candidates = shared
      ? [locale]
      : [locale, ...this.fallbackLocales.filter(candidate => candidate !== locale)]

    // Load and parse the first resource that exists.
    for (const candidate of candidates) {
      const key: ResourceKey = shared
        ? { scope: 'shared', id }
        : { scope: 'localized', id, locale: candidate }
      const source = await this.options.repository.load(key)
      if (!source) continue

      this.recordDependency(key)
      const parsed = await this.parseSource(source.text, key, candidate)
      const extracted = extractFragments(parsed.nodes ?? [], key, candidate)

      // Enforce fragment scope and record fallback usage.
      if (shared && extracted.fragments.size > 0) {
        throw new CompositionError(
          'SHARED_FRAGMENTS',
          'Gemeinsame Ressourcen dürfen keine Fragmente deklarieren.',
          key,
          candidate,
          [...this.activeResources],
        )
      }
      this.recordFragments(key, candidate, extracted.fragments)

      if (!shared && candidate !== locale) {
        this.diagnostics.push({
          code: 'LOCALE_FALLBACK',
          severity: 'warning',
          message: `${resourceLabel(key)} wurde als Fallback verwendet.`,
          resource: key,
          locale: candidate,
          chain: [...this.activeResources],
        })
      }

      return {
        key,
        locale: candidate,
        document: { ...parsed, nodes: extracted.body },
        fragments: extracted.fragments,
      }
    }

    throw new CompositionError(
      'RESOURCE_NOT_FOUND',
      `Ressource "${id}" wurde in ${shared ? 'shared' : `Locale ${locale}`} nicht gefunden.`,
      shared ? { scope: 'shared', id } : { scope: 'localized', id, locale },
      locale,
      [...this.activeResources],
    )
  }

  /** parseSource parses source text with the configured Comark parser options. */
  private async parseSource(
    source: string,
    key: ResourceKey,
    locale: string,
  ): Promise<ParsedDocument> {
    try {
      return (await parseMarkdown(
        source,
        this.options.parserOptions as Parameters<typeof parseMarkdown>[1],
      )) as unknown as ParsedDocument
    } catch (cause) {
      throw new CompositionError(
        'PARSE_ERROR',
        `Comark konnte ${resourceLabel(key)} nicht parsen: ${String(cause)}`,
        key,
        locale,
        [...this.activeResources],
      )
    }
  }

  /** expandResource resolves one resource while preserving its lexical fragment scope. */
  private async expandResource(
    resource: ParsedResource,
    inheritedScope: FragmentScope | undefined,
    depth: number,
  ): Promise<CompositionNode[]> {
    // Guard nesting and detect recursive resource references.
    if (depth > this.maxDepth) {
      throw new CompositionError(
        'MAX_DEPTH',
        `Maximale Kompositionstiefe (${this.maxDepth}) überschritten.`,
        resource.key,
        resource.locale,
        [...this.activeResources],
      )
    }

    const resourceIdentity = `${resourceLabel(resource.key)}@${resource.locale}`
    if (this.activeResources.includes(resourceIdentity)) {
      throw new CompositionError(
        'INCLUDE_CYCLE',
        `Zyklus erkannt: ${[...this.activeResources, resourceIdentity].join(' → ')}`,
        resource.key,
        resource.locale,
        [...this.activeResources, resourceIdentity],
      )
    }

    this.activeResources.push(resourceIdentity)
    try {
      // Select the resource's local fragment scope or inherit its caller's scope.
      const fragmentScope = this.createFragmentScope(resource, inheritedScope)
      let nodes = resource.document.nodes

      // Replace a localized document body with its validated shared layout.
      const layout = resource.document.frontmatter?.layout
      if (layout !== undefined) {
        nodes = await this.expandLayout(layout, resource, fragmentScope, depth)
      }

      return await this.expandNodes(nodes, fragmentScope, resource, depth)
    } finally {
      this.activeResources.pop()
    }
  }

  /** createFragmentScope returns local fragments or inherits the caller's scope. */
  private createFragmentScope(
    resource: ParsedResource,
    inheritedScope: FragmentScope | undefined,
  ): FragmentScope | undefined {
    if (resource.fragments.size === 0) return inheritedScope
    if (resource.key.scope === 'shared') {
      throw new CompositionError(
        'SHARED_FRAGMENTS',
        'Gemeinsame Ressourcen dürfen keine Fragmente deklarieren.',
        resource.key,
        resource.locale,
        [...this.activeResources],
      )
    }

    return {
      key: resource.key,
      locale: resource.locale,
      fragments: resource.fragments,
    }
  }

  /** expandLayout validates and expands the shared layout named by frontmatter. */
  private async expandLayout(
    layout: unknown,
    owner: ParsedResource,
    fragmentScope: FragmentScope | undefined,
    depth: number,
  ): Promise<CompositionNode[]> {
    this.needsFinalParse = true

    // Enforce the layout contract before loading its shared resource.
    if (
      typeof layout !== 'string' ||
      !layout.startsWith(SHARED_RESOURCE_PREFIX) ||
      !layout.slice(SHARED_RESOURCE_PREFIX.length)
    ) {
      throw new CompositionError(
        'INVALID_LAYOUT',
        'layout muss eine ID im Format "shared/<id>" sein.',
        owner.key,
        owner.locale,
      )
    }
    if (!isWhitespaceOrComment(owner.document.nodes)) {
      throw new CompositionError(
        'LAYOUT_BODY_CONTENT',
        'Ein Dokument mit Layout darf außerhalb von Fragmentdeklarationen keinen Inhalt enthalten.',
        owner.key,
        owner.locale,
      )
    }

    const layoutId = layout.slice(SHARED_RESOURCE_PREFIX.length)
    const layoutResource = await this.loadResource(layoutId, owner.locale, true)
    if (layoutResource.document.frontmatter?.layout !== undefined) {
      throw new CompositionError(
        'NESTED_LAYOUT',
        'Layouts dürfen kein eigenes layout deklarieren.',
        layoutResource.key,
        layoutResource.locale,
        [...this.activeResources],
      )
    }

    return this.expandResource(layoutResource, fragmentScope, depth + 1)
  }

  /** expandNodes recursively replaces include markers and copies ordinary nodes. */
  private async expandNodes(
    nodes: CompositionNode[],
    fragmentScope: FragmentScope | undefined,
    owner: ParsedResource,
    depth: number,
  ): Promise<CompositionNode[]> {
    const result: CompositionNode[] = []

    // Preserve ordinary nodes and expand markers at their original positions.
    for (const node of nodes) {
      if (!isMarker(node, 'include')) {
        if (isElement(node) && node[0] !== null) {
          const nested = await this.expandNodes(children(node), fragmentScope, owner, depth)
          result.push([node[0], structuredClone(node[1]), ...nested])
        } else {
          result.push(cloneNode(node))
        }
        continue
      }

      result.push(...await this.expandInclude(node, fragmentScope, owner, depth))
    }

    return result
  }

  /** expandInclude validates a marker and dispatches to its resource or fragment target. */
  private async expandInclude(
    node: CompositionNode,
    fragmentScope: FragmentScope | undefined,
    owner: ParsedResource,
    depth: number,
  ): Promise<CompositionNode[]> {
    // Validate marker shape and attributes before resolving its target.
    if (children(node).some(child => typeof child !== 'string' || child.trim() !== '')) {
      throw new CompositionError(
        'INVALID_INCLUDE_BODY',
        'include-Direktiven dürfen keinen eigenen Blockinhalt enthalten.',
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }

    const unknownAttributes = Object.keys(node[1]).filter(
      key => key !== 'src' && key !== 'fragment' && key !== '$',
    )
    if (unknownAttributes.length > 0) {
      throw new CompositionError(
        'INVALID_INCLUDE_ATTRIBUTE',
        `Unbekannte include-Attribute: ${unknownAttributes.join(', ')}`,
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }

    this.expansionCount += 1
    this.needsFinalParse = true
    if (this.expansionCount > this.maxExpansions) {
      throw new CompositionError(
        'MAX_EXPANSIONS',
        `Maximale Include-Anzahl (${this.maxExpansions}) überschritten.`,
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }

    const src = getStringAttribute(node, 'src')
    const fragment = getStringAttribute(node, 'fragment')
    this.validateIncludeAttributes(node, src, fragment, owner)

    // Resolve local fragments or load an explicit shared/localized resource.
    if (!src) {
      if (!fragmentScope || !fragment) {
        throw new CompositionError(
          'FRAGMENT_NOT_FOUND',
          `Fragment "${fragment ?? ''}" fehlt im aktuellen Fragmentkontext.`,
          owner.key,
          owner.locale,
          [...this.activeResources],
        )
      }
      return this.insertFragment(fragmentScope, fragment, depth)
    }

    const shared = src.startsWith(SHARED_RESOURCE_PREFIX)
    const resourceId = shared ? src.slice(SHARED_RESOURCE_PREFIX.length) : src
    const target = await this.loadResource(resourceId, owner.locale, shared)

    if (fragment) return this.insertNamedFragment(target, fragment, depth)

    const inheritedScope = shared ? fragmentScope : undefined
    return this.expandResource(target, inheritedScope, depth + 1)
  }

  /** validateIncludeAttributes checks required values and supported marker syntax. */
  private validateIncludeAttributes(
    node: CompositionNode,
    src: string | undefined,
    fragment: string | undefined,
    owner: ParsedResource,
  ): void {
    if (isElement(node) && 'src' in node[1] && !src) {
      throw new CompositionError(
        'INVALID_INCLUDE_ATTRIBUTE',
        'src darf nicht leer sein.',
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }
    if (isElement(node) && 'fragment' in node[1] && !fragment) {
      throw new CompositionError(
        'INVALID_INCLUDE_ATTRIBUTE',
        'fragment darf nicht leer sein.',
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }
    if (!src && !fragment) {
      throw new CompositionError(
        'INVALID_INCLUDE',
        'include benötigt src oder fragment.',
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }
    if (fragment && !/^[\w.-]+$/.test(fragment)) {
      throw new CompositionError(
        'INVALID_INCLUDE_ATTRIBUTE',
        'fragment muss einen gültigen Fragmentnamen enthalten.',
        owner.key,
        owner.locale,
        [...this.activeResources],
      )
    }
  }

  /** insertNamedFragment selects a named fragment from an explicitly loaded resource. */
  private insertNamedFragment(
    resource: ParsedResource,
    name: string,
    depth: number,
  ): Promise<CompositionNode[]> {
    if (resource.fragments.size === 0 || resource.key.scope === 'shared') {
      throw new CompositionError(
        'FRAGMENT_NOT_FOUND',
        `Fragment "${name}" fehlt in ${resourceLabel(resource.key)}.`,
        resource.key,
        resource.locale,
        [...this.activeResources],
      )
    }

    return this.insertFragment(
      { key: resource.key, locale: resource.locale, fragments: resource.fragments },
      name,
      depth,
    )
  }

  /** insertFragment copies and expands one fragment within its owning lexical scope. */
  private async insertFragment(
    scope: FragmentScope,
    name: string,
    depth: number,
  ): Promise<CompositionNode[]> {
    const nodes = scope.fragments.get(name)
    if (!nodes) {
      throw new CompositionError(
        'FRAGMENT_NOT_FOUND',
        `Fragment "${name}" fehlt im aktuellen Fragmentkontext.`,
        scope.key,
        scope.locale,
        [...this.activeResources],
      )
    }

    // Guard fragment recursion and mark this declaration as used.
    const fragmentIdentity = `${resourceLabel(scope.key)}#${name}`
    if (this.activeFragments.includes(fragmentIdentity)) {
      throw new CompositionError(
        'INCLUDE_CYCLE',
        `Fragmentzyklus erkannt: ${[...this.activeFragments, fragmentIdentity].join(' → ')}`,
        scope.key,
        scope.locale,
        [...this.activeResources, ...this.activeFragments, fragmentIdentity],
      )
    }

    this.usedFragments.add(`${resourceLabel(scope.key)}:${name}`)
    this.activeFragments.push(fragmentIdentity)
    try {
      const owner: ParsedResource = {
        key: scope.key,
        locale: scope.locale,
        document: { nodes: [], frontmatter: {}, meta: {} },
        fragments: scope.fragments,
      }
      return await this.expandNodes(nodes, scope, owner, depth)
    } finally {
      this.activeFragments.pop()
    }
  }

  /** recordDependency adds each selected resource to the result once. */
  private recordDependency(key: ResourceKey): void {
    const label = resourceLabel(key)
    if (this.dependencies.some(dependency => resourceLabel(dependency) === label)) return

    this.dependencies.push(key)
  }

  /** recordFragments tracks declarations for later unused-fragment diagnostics. */
  private recordFragments(
    key: ResourceKey,
    locale: string,
    fragments: Map<string, CompositionNode[]>,
  ): void {
    for (const name of fragments.keys()) {
      this.declaredFragments.set(`${resourceLabel(key)}:${name}`, { name, key, locale })
    }
  }

  /** reportUnusedFragments adds diagnostics for fragment declarations without consumers. */
  private reportUnusedFragments(): void {
    for (const fragment of this.declaredFragments.values()) {
      if (this.usedFragments.has(`${resourceLabel(fragment.key)}:${fragment.name}`)) continue

      this.diagnostics.push({
        code: 'UNUSED_FRAGMENT',
        severity: this.options.unusedFragmentsAsErrors ? 'error' : 'warning',
        message: `Fragment "${fragment.name}" wird nicht verwendet.`,
        resource: fragment.key,
        locale: fragment.locale,
      })
    }
  }

  /** countNodes returns the total AST node count, including descendants. */
  private countNodes(nodes: CompositionNode[]): number {
    return nodes.reduce((count, node) => {
      const childCount = isElement(node) ? this.countNodes(children(node)) : 0
      return count + 1 + childCount
    }, 0)
  }

  /** assertNoCompositionMarkers rejects markers that survived recursive expansion. */
  private assertNoCompositionMarkers(nodes: CompositionNode[], root: ParsedResource): void {
    for (const node of nodes) {
      if (isMarker(node, 'fragment') || isMarker(node, 'include')) {
        throw new CompositionError(
          'UNRESOLVED_MARKER',
          `Kompositionsmarker "${isElement(node) ? node[0] : ''}" ist im Ergebnis verblieben.`,
          root.key,
          root.locale,
        )
      }
      if (isElement(node)) this.assertNoCompositionMarkers(children(node), root)
    }
  }

  /** buildDocument preserves standalone ASTs and reparses composed output with Comark. */
  private async buildDocument(
    root: ParsedResource,
    body: CompositionNode[],
  ): Promise<ResolvedContent['document']> {
    if (!this.needsFinalParse) return root.document as unknown as ResolvedContent['document']

    try {
      const markdown = await renderMarkdown({
        nodes: body,
        frontmatter: root.document.frontmatter ?? {},
        meta: {},
      } as Parameters<typeof renderMarkdown>[0])

      return await parseMarkdown(
        markdown,
        this.options.parserOptions as Parameters<typeof parseMarkdown>[1],
      )
    } catch (cause) {
      throw new CompositionError(
        'FINAL_PARSE_ERROR',
        `Comark konnte das zusammengesetzte Dokument nicht finalisieren: ${String(cause)}`,
        root.key,
        root.locale,
        this.dependencies.map(resourceLabel),
      )
    }
  }
}

/** createContentResolver creates a reusable facade with isolated state per request. */
export function createContentResolver(options: ResolverOptions): ContentResolver {
  return {
    /** resolve returns a localized document composed from repository resources. */
    resolve(request) {
      return new ResolutionSession(options).resolve(request)
    },
  }
}
