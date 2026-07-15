// components/admin/section-pagination.tsx
// 客户端分页控件：上一页/下一页 + 每页大小切换
// 通过 URL search params 驱动，便于分享/前进/后退

'use client'

import { useRouter } from 'next/navigation'

type Props = {
  total: number
  currentPage: number
  pageSize: number
  // 该 section 的 URL search param key（区分不同 section）
  pageKey: string
  sizeKey: string
  // 当前 URL 其他 search params（保留以免互相覆盖）
  preserve?: Record<string, string>
}

const SIZE_OPTIONS = [10, 20, 50]

export function SectionPagination({
  total, currentPage, pageSize, pageKey, sizeKey, preserve = {},
}: Props) {
  const router = useRouter()
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const baseDisabled = total <= pageSize

  function navigate(patch: Record<string, string>) {
    const sp = new URLSearchParams(preserve)
    // 顺序：先打补丁，再设 pageKey/sizeKey（覆盖）
    for (const [k, v] of Object.entries(patch)) sp.set(k, v)
    // 没设置 page 时显式设 1，避免停留在旧 page
    if (!sp.has(pageKey)) sp.set(pageKey, '1')
    router.push(`?${sp.toString()}`)
  }

  function go(p: number) {
    if (p < 1 || p > totalPages) return
    navigate({ [pageKey]: String(p) })
  }

  function setSize(n: number) {
    // 改 size 时重置到第 1 页（避免跳到空页）
    navigate({ [sizeKey]: String(n), [pageKey]: '1' })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mt-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1 || baseDisabled}
          onClick={() => go(currentPage - 1)}
          className="text-xs px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
        >
          上一页
        </button>
        <span className="text-xs text-muted-foreground px-2">
          {baseDisabled ? '1' : `${currentPage} / ${totalPages}`} 页（共 {total} 条）
        </span>
        <button
          type="button"
          disabled={currentPage >= totalPages || baseDisabled}
          onClick={() => go(currentPage + 1)}
          className="text-xs px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
        >
          下一页
        </button>
      </div>
      <div className="flex items-center gap-1 ml-auto">
        <span className="text-xs text-muted-foreground">每页</span>
        {SIZE_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSize(n)}
            disabled={n === pageSize}
            className={
              'text-xs px-2 py-1 rounded border ' +
              (n === pageSize
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-muted border-input')
            }
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}
