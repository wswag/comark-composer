import { describe, expect, it } from 'vitest'
import { createContentResolver } from '../src/index.js'
import { renderMarkdown } from 'comark/render'
import type { ContentRepository, ResourceKey } from '../src/index.js'

/** Build an in-memory repository for resolver tests. */
function repository(files: Record<string, string>): ContentRepository {
  return {
    async load(key: ResourceKey) {
      const name = key.scope === 'shared' ? `shared/${key.id}` : `${key.locale}/${key.id}`
      return files[name] === undefined ? null : { text: files[name]!, revision: 'test' }
    },
  }
}

describe('comark-composer resolver', () => {
  it('resolves a standalone Comark document and keeps frontmatter', async () => {
    const resolver = createContentResolver({ repository: repository({ 'de/home': '---\ntitle: Start\n---\n# Hallo' }) })
    const result = await resolver.resolve({ id: 'home', locale: 'de' })
    expect(result.document.frontmatter?.title).toBe('Start')
    expect(result.document.nodes[0]?.[0]).toBe('h1')
  })

  it('composes fragments through a shared layout and removes markers', async () => {
    const resolver = createContentResolver({ repository: repository({
      'de/features': '---\nid: features\nlayout: shared/features\n---\n::fragment{name="intro"}\n# Planung\n::',
      'shared/features': '::box\n::include{fragment="intro"}\n::',
    }) })
    const result = await resolver.resolve({ id: 'features', locale: 'de' })
    expect(result.document.nodes).toEqual([['box', {}, ['h1', { id: 'planung' }, 'Planung']]])
  })

  it('resolves explicit localized resource references', async () => {
    const resolver = createContentResolver({ repository: repository({
      'de/home': '# Start\n\n::include{src="footer"}\n::',
      'de/footer': 'Text',
    }) })
    const result = await resolver.resolve({ id: 'home', locale: 'de' })
    expect(JSON.stringify(result.document.nodes)).toContain('Text')
    expect(result.dependencies).toHaveLength(2)
  })

  it('uses configured fallback locales and reports them', async () => {
    const resolver = createContentResolver({ repository: repository({ 'en/home': '# Home' }), fallbackLocales: ['en'] })
    const result = await resolver.resolve({ id: 'home', locale: 'de' })
    expect(result.locale).toBe('en')
    expect(result.diagnostics[0]?.code).toBe('LOCALE_FALLBACK')
  })

  it('rejects missing fragments and recursive includes', async () => {
    const missing = createContentResolver({ repository: repository({ 'de/home': '::include{fragment="nope"}::' }) })
    await expect(missing.resolve({ id: 'home', locale: 'de' })).rejects.toMatchObject({ diagnostic: { code: 'FRAGMENT_NOT_FOUND' } })
    const cycle = createContentResolver({ repository: repository({
      'de/home': '::include{src="part"}::', 'de/part': '::include{src="home"}::',
    }) })
    await expect(cycle.resolve({ id: 'home', locale: 'de' })).rejects.toMatchObject({ diagnostic: { code: 'INCLUDE_CYCLE' } })
  })

  it('rejects fragment cycles and duplicate fragment names', async () => {
    const cycle = createContentResolver({ repository: repository({
      'de/home': '---\nlayout: shared/layout\n---\n::fragment{name="loop"}\n::include{fragment="loop"}::\n::',
      'shared/layout': '::include{fragment="loop"}::',
    }) })
    await expect(cycle.resolve({ id: 'home', locale: 'de' })).rejects.toMatchObject({ diagnostic: { code: 'INCLUDE_CYCLE' } })
    const duplicate = createContentResolver({ repository: repository({
      'de/home': '::fragment{name="x"}\na\n::\n\n::fragment{name="x"}\nb\n::',
    }) })
    await expect(duplicate.resolve({ id: 'home', locale: 'de' })).rejects.toMatchObject({ diagnostic: { code: 'DUPLICATE_FRAGMENT' } })
  })

  it('allows repeated includes with isolated heading IDs and enforces output limits', async () => {
    const resolver = createContentResolver({ repository: repository({
      'de/home': '::fragment{name="part"}\n# Hi\n::\n\n::include{fragment="part"}\n::\n\n::include{fragment="part"}\n::',
    }) })
    const result = await resolver.resolve({ id: 'home', locale: 'de' })
    const headings = result.document.nodes.filter(node => Array.isArray(node) && node[0] === 'h1')
    expect(headings.map(node => (node as unknown[])[1])).toEqual([{ id: 'hi' }, { id: 'hi-1' }])
    expect(headings[0]).not.toBe(headings[1])
    const limited = createContentResolver({ repository: repository({ 'de/home': '# Big' }), maxOutputNodes: 1 })
    await expect(limited.resolve({ id: 'home', locale: 'de' })).rejects.toMatchObject({ diagnostic: { code: 'MAX_OUTPUT_NODES' } })
  })

  it('keeps results JSON serializable, renderable, and isolated across concurrent locales', async () => {
    const resolver = createContentResolver({ repository: repository({
      'de/home': '# Willkommen', 'en/home': '# Welcome',
    }) })
    const [de, en] = await Promise.all([
      resolver.resolve({ id: 'home', locale: 'de' }),
      resolver.resolve({ id: 'home', locale: 'en' }),
    ])
    expect(de.locale).toBe('de')
    expect(en.locale).toBe('en')
    expect(JSON.parse(JSON.stringify(de.document))).toEqual(de.document)
    expect(await renderMarkdown(de.document)).toContain('Willkommen')
  })
})
