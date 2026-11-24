import { createContentResolver } from '../src/index.js'

const resources: Record<string, string> = {
  'de/home': `---\nlayout: shared/home\ntitle: Hallo\n---\n::fragment{name="intro"}\n# Hallo aus dem Playground\n\nDieses Beispiel zeigt die Komposition im Paket ohne HTTP oder Anwendungshülle.\n::`,
  'shared/home': '::article\n::include{fragment="intro"}\n::',
}

const resolver = createContentResolver({
  repository: {
    /** load returns an in-memory Markdown resource for the requested key. */
    async load(key) {
      const path = key.scope === 'shared'
        ? `shared/${key.id}`
        : `${key.locale}/${key.id}`
      const text = resources[path]
      return text === undefined ? null : { text }
    },
  },
})

const result = await resolver.resolve({ id: 'home', locale: 'de' })
console.log(JSON.stringify(result, null, 2))
