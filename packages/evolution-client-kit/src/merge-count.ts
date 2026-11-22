import { ROUTES } from './generated/routes.generated.ts'

/** The pending merge count, read with the same wire version the merge client requires. */
export async function fetchMergePendingCount(fetchImpl: typeof fetch = fetch): Promise<number> {
  try {
    const response = await fetchImpl(ROUTES.merge.view, { headers: { accept: 'application/json' } })
    if (!response.ok) return 0
    const body = await response.json() as { readonly wireVersion?: unknown; readonly counts?: { readonly active?: { readonly pending?: unknown } } }
    if (body.wireVersion !== 1) return 0
    const count = Number(body.counts?.active?.pending ?? 0)
    return Number.isFinite(count) && count > 0 ? count : 0
  } catch { return 0 }
}
