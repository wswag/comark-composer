import type { MarkdownDocument } from 'comark'

export type ResourceKey =
  | { scope: 'localized'; id: string; locale: string }
  | { scope: 'shared'; id: string }

export interface ContentRequest {
  id: string
  locale: string
}

export interface ContentSource {
  text: string
  revision?: string
}

export interface ContentRepository {
  load(key: ResourceKey): Promise<ContentSource | null>
}

export interface Diagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
  resource?: ResourceKey
  locale?: string
  chain?: string[]
}

export interface ResolverOptions {
  repository: ContentRepository
  fallbackLocales?: readonly string[]
  maxDepth?: number
  maxExpansions?: number
  maxOutputNodes?: number
  parserOptions?: Record<string, unknown>
  unusedFragmentsAsErrors?: boolean
}

export interface ResolvedContent {
  id: string
  requestedLocale: string
  locale: string
  document: MarkdownDocument
  dependencies: ResourceKey[]
  diagnostics: Diagnostic[]
}

export interface ContentResolver {
  resolve(request: ContentRequest): Promise<ResolvedContent>
}
