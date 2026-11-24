import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { ContentRepository, ContentSource, ResourceKey } from '../types.js'

function assertId(id: string): void {
  if (!id || id.includes('\\') || id.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(id) || id.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError(`Ungültige Ressourcen-ID: ${id}`)
  }
}

/** Create a repository for content/{locale,id}.md and content/shared/{id}.md. */
export function createFilesystemRepository(root: string): ContentRepository {
  const absoluteRoot = resolve(root)

  return {
    async load(key: ResourceKey): Promise<ContentSource | null> {
      assertId(key.id)
      if (key.scope === 'localized') assertId(key.locale)
      const candidate = resolve(absoluteRoot, key.scope === 'shared' ? 'shared' : key.locale, `${key.id}.md`)
      if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${sep}`)) throw new TypeError('Ressourcenpfad verlässt das Content-Root.')
      let rootReal: string
      try {
        rootReal = await realpath(absoluteRoot)
      } catch (error) {
        throw error
      }
      try {
        const fileReal = await realpath(candidate)
        if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}${sep}`)) throw new TypeError('Symlink verlässt das Content-Root.')
        const [text, info] = await Promise.all([readFile(fileReal, 'utf8'), stat(fileReal)])
        return { text, revision: `${info.size}-${info.mtimeMs}` }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
