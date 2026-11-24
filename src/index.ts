/**
 * Resolve localized Comark content with shared layouts and fragments.
 * Import the Node filesystem repository from `comark-composer/filesystem`.
 */
export { createContentResolver } from './resolver.js'
export { CompositionError } from './diagnostics.js'
export type {
  ContentRepository, ContentRequest, ContentResolver, ContentSource, Diagnostic,
  ResolvedContent, ResolverOptions, ResourceKey,
} from './types.js'
