import { describe, expect, it, vi } from 'vitest'
import { createHttpRepository } from '../src/adapters/http.js'
import type { ResourceKey } from '../src/index.js'

describe('HTTP repository', () => {
  it('loads locale resources and preserves response validators', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('# Hallo', {
      status: 200,
      headers: { etag: '"rev-7"' },
    }))
    const repository = createHttpRepository({
      baseUrl: '/api/content/',
      fetch: fetcher,
      headers: { Authorization: 'Bearer token' },
    })

    await expect(repository.load({ scope: 'localized', locale: 'de-DE', id: 'pages/home page' }))
      .resolves.toEqual({ text: '# Hallo', revision: '"rev-7"' })
    expect(fetcher).toHaveBeenCalledWith('/api/content/de-DE/pages/home%20page.md', {
      method: 'GET',
      headers: { Authorization: 'Bearer token' },
      credentials: undefined,
    })
  })

  it('loads shared resources and maps only 404 responses to null', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('## Shared', { status: 200 }))
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
    const repository = createHttpRepository({ baseUrl: 'https://example.test/content', fetch: fetcher })

    await expect(repository.load({ scope: 'shared', id: 'layouts/main' }))
      .resolves.toEqual({ text: '## Shared' })
    await expect(repository.load({ scope: 'localized', locale: 'de', id: 'missing' }))
      .resolves.toBeNull()
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://example.test/content/shared/layouts/main.md',
      'https://example.test/content/de/missing.md',
    ])
  })

  it('supports custom routes and surfaces non-404 HTTP failures', async () => {
    const key: ResourceKey = { scope: 'localized', locale: 'de', id: 'home' }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status: 503 }))
    const repository = createHttpRepository({
      baseUrl: '/unused',
      fetch: fetcher,
      urlFor: resource => resource.scope === 'localized'
        ? `/v2/content/${resource.locale}/${resource.id}`
        : `/v2/shared/${resource.id}`,
      credentials: 'include',
    })

    await expect(repository.load(key)).rejects.toThrow('HTTP 503')
    expect(fetcher).toHaveBeenCalledWith('/v2/content/de/home', expect.objectContaining({ credentials: 'include' }))
  })

  it('rejects unsafe resource keys before calling fetch', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const repository = createHttpRepository({ baseUrl: '/content', fetch: fetcher })

    await expect(repository.load({ scope: 'localized', locale: 'de', id: '../secret' })).rejects.toThrow(/Ressourcenschlüssel/)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
