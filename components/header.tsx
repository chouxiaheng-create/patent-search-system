// components/header.tsx
'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Bell, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface HeaderProps {
  displayName: string | null
  unreadCount?: number
}

const breadcrumbMap: Record<string, string> = {
  dashboard: '我的任务',
  search: '检索',
  new: '新建检索',
  'step-1': '上传文件',
  'step-2': '配置检索',
  'step-3': '确认提交',
  progress: '执行进度',
  report: '查看报告',
  settings: '设置',
  models: '模型库',
}

function getBreadcrumbs(pathname: string) {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: Array<{ label: string; href: string }> = []
  let path = ''

  for (const seg of segments) {
    path += `/${seg}`
    const label = breadcrumbMap[seg]
    if (label) {
      crumbs.push({ label, href: path })
    }
  }

  return crumbs
}

export function Header({ displayName, unreadCount = 0 }: HeaderProps) {
  const pathname = usePathname()
  const breadcrumbs = getBreadcrumbs(pathname)

  const initials = displayName
    ? displayName.slice(0, 1).toUpperCase()
    : '?'

  return (
    <header className="h-14 border-b border-sidebar-border bg-sidebar/95 flex items-center justify-between px-6">
      {/* 面包屑 */}
      <nav className="flex items-center gap-1 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <div key={crumb.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-sidebar-foreground/80" />}
            {i === breadcrumbs.length - 1 ? (
              <span className="font-medium text-sidebar-foreground">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors">
                {crumb.label}
              </Link>
            )}
          </div>
        ))}
      </nav>

      {/* 右侧操作 */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="relative rounded-full text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-200">
          <Bell size={16} strokeWidth={2} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1.5 w-2 h-2 bg-destructive rounded-full ring-1 ring-background" />
          )}
        </Button>
        <div className="flex items-center gap-2 pl-2 ml-1 border-l border-white/[0.12]">
          <Avatar className="w-7 h-7">
            <AvatarFallback className="bg-white/15 text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-sidebar-foreground">{displayName ?? '用户'}</span>
        </div>
      </div>
    </header>
  )
}
