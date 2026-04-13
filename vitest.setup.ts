import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)

/**
 * Patch require.cache so that require('@supabase/ssr') returns the vi.mock'd
 * module (if one is active) rather than the real CJS module.
 *
 * Vitest's vi.mock() intercepts ESM `import` calls but not Node's synchronous
 * `require()`. By populating require.cache before each test with the result of
 * `await import('@supabase/ssr')` (which DOES respect vi.mock), subsequent
 * synchronous require() calls inside tests receive the mocked module.
 */
beforeEach(async () => {
  const resolvedPath = _require.resolve('@supabase/ssr')
  // Import the module — vitest will return the mocked version if vi.mock is active
  const mod = await import('@supabase/ssr')
  ;(_require as any).cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: mod,
    children: [],
    paths: [],
    parent: null,
  }
})
