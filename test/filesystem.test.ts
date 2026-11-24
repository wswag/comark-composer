import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemRepository } from '../src/adapters/filesystem.js'

const temporaryRoots: string[] = []

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'comark-composer-'))
  temporaryRoots.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('filesystem repository', () => {
  it('maps locale and shared keys and returns null for missing files', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'de'), { recursive: true })
    await mkdir(join(root, 'shared'), { recursive: true })
    await writeFile(join(root, 'de', 'home.md'), '# Hallo')
    await writeFile(join(root, 'shared', 'layout.md'), '::box::')
    const repository = createFilesystemRepository(root)
    await expect(repository.load({ scope: 'localized', locale: 'de', id: 'home' })).resolves.toMatchObject({ text: '# Hallo' })
    await expect(repository.load({ scope: 'shared', id: 'layout' })).resolves.toMatchObject({ text: '::box::' })
    await expect(repository.load({ scope: 'localized', locale: 'de', id: 'missing' })).resolves.toBeNull()
  })

  it('rejects traversal and symlink escapes', async () => {
    const parent = await tempRoot()
    const root = join(parent, 'content')
    const outside = join(parent, 'outside')
    await mkdir(join(root, 'de'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.md'), 'secret')
    await symlink(join(outside, 'secret.md'), join(root, 'de', 'escape.md'))
    const repository = createFilesystemRepository(root)
    await expect(repository.load({ scope: 'localized', locale: 'de', id: '../outside/secret' })).rejects.toThrow()
    await expect(repository.load({ scope: 'localized', locale: 'de', id: 'escape' })).rejects.toThrow(/Symlink/)
  })
})
