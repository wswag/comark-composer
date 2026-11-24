import type { Diagnostic, ResourceKey } from './types.js'

/** Represent a resolution failure with structured diagnostic details. */
export class CompositionError extends Error {
  readonly diagnostic: Diagnostic

  /** Build a stable error with resource and resolution context. */
  constructor(code: string, message: string, resource?: ResourceKey, locale?: string, chain: string[] = []) {
    // Preserve the error message and attach a structured diagnostic.
    super(message)
    this.name = 'CompositionError'
    this.diagnostic = { code, severity: 'error', message, resource, locale, chain }
  }
}

/** Format a resource key for diagnostics and cycle detection. */
export function resourceLabel(key: ResourceKey): string {
  return key.scope === 'shared' ? `shared:${key.id}` : `${key.locale}:${key.id}`
}
