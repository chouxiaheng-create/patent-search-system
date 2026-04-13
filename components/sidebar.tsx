// components/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Search,
  Settings,
  Shield,
  LogOut,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: '我的任务', icon: LayoutDashboard },
  { href: '/search/new', label: '新建检索', icon: Search },
  { href: '/settings/models', label: '模型库', icon: Settings },
]

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-56 min-h-screen bg-white border-r border-slate-200 flex flex-col">
      <div className="p-4 border-b border-slate-200">
        <h1 className="text-sm font-bold text-blue-600 leading-tight">
          专利检索<br />智能体
        </h1>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}

        {isAdmin && (
          <>
            <div className="pt-2 pb-1">
              <p className="px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">管理</p>
            </div>
            <Link
              href="/admin/users"
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-purple-50 text-purple-700'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <Shield size={16} />
              管理后台
            </Link>
          </>
        )}
      </nav>

      <div className="p-3 border-t border-slate-200">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-500 hover:text-red-600"
          onClick={handleLogout}
        >
          <LogOut size={16} className="mr-2" />
          退出登录
        </Button>
      </div>
    </aside>
  )
}
