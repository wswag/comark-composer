import type { MarkdownDocument } from 'comark'

/** Identify a resource by shared scope or by locale and logical ID. */
export type ResourceKey =
  | { scope: 'localized'; id: string; locale: string }
  | { scope: 'shared'; id: string }

/** Select the localized root document to resolve. */
export interface ContentRequest {
  id: string
  locale: string
}

/** Provide a resource's Markdown source and optional revision. */
export interface ContentSource {
  text: string
  revision?: string
}

/** Load Comark resources without imposing a storage implementation. */
export interface ContentRepository {
  /** Load a resource or return null when it does not exist. */
  load(key: ResourceKey): Promise<ContentSource | null>
}

/** Describe a warning or resolution failure independently of the document. */
export interface Diagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
  resource?: ResourceKey
  locale?: string
  chain?: string[]
}

/** Configure storage, parser behavior, fallback locales, and safety limits. */
export interface ResolverOptions {
  repository: ContentRepository
  fallbackLocales?: readonly string[]
  maxDepth?: number
  maxExpansions?: number
  maxOutputNodes?: number
  parserOptions?: Record<string, unknown>
  unusedFragmentsAsErrors?: boolean
}

/** Return the native Comark document and its resolution metadata. */
export interface ResolvedContent {
  id: string
  requestedLocale: string
  locale: string
  document: MarkdownDocument
  dependencies: ResourceKey[]
  diagnostics: Diagnostic[]
}

/** Resolve localized Comark content through a configured repository. */
export interface ContentResolver {
  /** Resolve a localized document and return its native Comark document. */
  resolve(request: ContentRequest): Promise<ResolvedContent>
}
