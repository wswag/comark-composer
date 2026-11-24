import type { ContentRepository, ContentSource, ResourceKey } from '../types.js'
import { resourceLabel } from '../diagnostics.js'

export type HttpHeaders = Record<string, string>

export interface HttpRepositoryOptions {
  /** Base path that serves localized and shared Markdown resources. */
  baseUrl: string
  /** Fetch implementation; defaults to the runtime's global fetch. */
  fetch?: typeof globalThis.fetch
  /** Static or resource-specific request headers. */
  headers?: HttpHeaders | ((key: ResourceKey) => HttpHeaders)
  /** Request credentials policy for cookie-authenticated endpoints. */
  credentials?: 'omit' | 'same-origin' | 'include'
  /** Custom route mapping for applications with a different endpoint shape. */
  urlFor?: (key: ResourceKey) => string
}

/** validateResourceKey rejects path values that could escape the HTTP content route. */
function validateResourceKey(key: ResourceKey): void {
  const invalidId = !key.id ||
    key.id.includes('\\') ||
    key.id.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(key.id) ||
    key.id.split('/').some(segment => segment === '' || segment === '.' || segment === '..')

  const invalidLocale = key.scope === 'localized' && (
    !key.locale ||
    key.locale.includes('/') ||
    key.locale.includes('\\') ||
    /^[a-z][a-z\d+.-]*:/i.test(key.locale)
  )

  if (invalidId || invalidLocale) throw new TypeError('Ungültiger HTTP-Ressourcenschlüssel.')
}

/** encodeResourceId encodes each logical ID segment without changing its hierarchy. */
function encodeResourceId(id: string): string {
  return id.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/** defaultResourceUrl maps a resource key to the documented HTTP route shape. */
function defaultResourceUrl(baseUrl: string, key: ResourceKey): string {
  const prefix = baseUrl.replace(/\/+$/, '')
  const resourcePath = key.scope === 'shared'
    ? `shared/${encodeResourceId(key.id)}.md`
    : `${encodeURIComponent(key.locale)}/${encodeResourceId(key.id)}.md`

  return `${prefix}/${resourcePath}`
}

/** createHttpRepository loads embedded or remote Markdown through an HTTP endpoint. */
export function createHttpRepository(options: HttpRepositoryOptions): ContentRepository {
  const fetcher = options.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new TypeError('Diese Laufzeit stellt kein fetch bereit; übergib HttpRepositoryOptions.fetch.')
  }

  return {
    /** load fetches one resource and treats only HTTP 404 as absence. */
    async load(key: ResourceKey): Promise<ContentSource | null> {
      // Construct the route and attach request-specific authentication headers.
      validateResourceKey(key)
      const url = options.urlFor?.(key) ?? defaultResourceUrl(options.baseUrl, key)
      const headers = typeof options.headers === 'function'
        ? options.headers(key)
        : options.headers

      // Fetch the resource and distinguish absence from service failures.
      const response = await fetcher(url, {
        method: 'GET',
        headers,
        credentials: options.credentials,
      })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} beim Laden von ${url} (${resourceLabel(key)}).`)
      }

      // Preserve an HTTP validator as the repository revision.
      const text = await response.text()
      const revision = response.headers.get('etag') ?? response.headers.get('last-modified') ?? undefined
      return revision ? { text, revision } : { text }
    },
  }
}
