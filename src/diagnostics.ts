import type { Diagnostic, ResourceKey } from './types.js'

export class CompositionError extends Error {
  readonly diagnostic: Diagnostic

  constructor(code: string, message: string, resource?: ResourceKey, locale?: string, chain: string[] = []) {
    super(message)
    this.name = 'CompositionError'
    this.diagnostic = { code, severity: 'error', message, resource, locale, chain }
  }
}

export function resourceLabel(key: ResourceKey): string {
  return key.scope === 'shared' ? `shared:${key.id}` : `${key.locale}:${key.id}`
}
