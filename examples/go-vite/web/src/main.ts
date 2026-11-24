import { renderHtmlFromDocument } from '@comark/html'
import { createContentResolver } from 'comark-composer'
import { createHttpRepository } from 'comark-composer/http'
import './style.css'

const app = document.querySelector<HTMLElement>('#app')
const languageButtons = document.querySelectorAll<HTMLButtonElement>('[data-locale]')

if (!app) {
  throw new Error('Das Element #app fehlt.')
}

const resolver = createContentResolver({
  repository: createHttpRepository({ baseUrl: '/content' }),
  fallbackLocales: ['en'],
})

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    void showHelloWorld(button.dataset.locale as 'de' | 'en')
  })
}

void showHelloWorld('de')

/** Loads, composes, and renders the hello-world document in the selected locale. */
async function showHelloWorld(locale: 'de' | 'en'): Promise<void> {
  document.documentElement.lang = locale
  languageButtons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.locale === locale))
  })

  try {
    const result = await resolver.resolve({ id: 'home', locale })
    const html = await renderHtmlFromDocument(result.document)
    app.innerHTML = html

    if (result.diagnostics.length > 0) {
      console.info('Comark-Auflösungshinweise:', result.diagnostics)
    }
  } catch (error) {
    app.innerHTML = `<p class="error">${escapeHtml(errorMessage(error))}</p>`
  }
}

/** Returns a readable message for an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Escapes an error message before placing it in the page. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}
