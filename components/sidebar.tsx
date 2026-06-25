// components/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  LayoutDashboard,
  Search,
  Settings,
  Shield,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useState, useEffect } from 'react'

const navItems = [
  { href: '/dashboard', label: '我的任务', icon: LayoutDashboard },
  { href: '/search/new/step-1', label: '新建检索', icon: Search },
  { href: '/settings/models', label: '模型库', icon: Settings },
]

function NavContent({
  isAdmin, pathname, collapsed, onNavigate,
}: {
  isAdmin: boolean; pathname: string; collapsed?: boolean; onNavigate?: () => void
}) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const iconSize = 18

  return (
    <>
      <div className={cn('py-6', collapsed ? 'px-3 flex flex-col items-center' : 'px-5')}>
        <Link href="/dashboard" className="inline-block group" onClick={onNavigate}>
          {collapsed ? (
            <span className="text-lg font-bold text-sidebar-foreground">专</span>
          ) : (
            <>
              <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">专利检索</span>
              <span className="block text-sm font-medium text-sidebar-foreground/60 tracking-wide">智能体</span>
            </>
          )}
        </Link>
      </div>

      <nav className={cn('flex-1 space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href
          const linkContent = (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center rounded-xl text-sm font-medium transition-all duration-200',
                collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2',
                isActive
                  ? 'bg-white/10 text-sidebar-foreground'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-accent-foreground hover:bg-white/10'
              )}
            >
              <Icon size={iconSize} strokeWidth={2} />
              {!collapsed && label}
            </Link>
          )

          if (collapsed) {
            return (
              <Tooltip key={href} delayDuration={0}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right"><p>{label}</p></TooltipContent>
              </Tooltip>
            )
          }
          return linkContent
        })}

        {isAdmin && (
          <>
            {!collapsed && (
              <p className="px-3 pt-4 pb-1 text-xs font-semibold text-sidebar-foreground/60 tracking-widest uppercase">
                管理
              </p>
            )}
            {collapsed && <div className="h-4" />}
            <Link
              href="/admin/users"
              onClick={onNavigate}
              className={cn(
                'flex items-center rounded-xl text-sm font-medium transition-all duration-200',
                collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2',
                pathname.startsWith('/admin')
                  ? 'bg-white/10 text-sidebar-foreground'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-accent-foreground hover:bg-white/10'
              )}
            >
              <Shield size={iconSize} strokeWidth={2} />
              {!collapsed && '管理后台'}
            </Link>
          </>
        )}
      </nav>

      <div className={cn('border-t border-white/[0.08]', collapsed ? 'p-2' : 'p-3')}>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'text-sm font-medium text-sidebar-foreground/60 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200',
            collapsed ? 'w-full justify-center p-2.5' : 'w-full justify-start'
          )}
          onClick={() => { handleLogout(); onNavigate?.() }}
        >
          <LogOut size={iconSize} strokeWidth={2} className={collapsed ? '' : 'mr-2'} />
          {!collapsed && '退出登录'}
        </Button>
      </div>
    </>
  )
}

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // 从 localStorage 恢复折叠状态
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
  }, [])

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }

  return (
    <TooltipProvider delayDuration={0}>
      {/* 桌面端侧边栏 */}
      <aside className={cn(
        'hidden lg:flex flex-col border-r border-white/[0.08] bg-sidebar transition-all duration-300',
        collapsed ? 'w-16' : 'w-56'
      )}>
        <NavContent isAdmin={isAdmin} pathname={pathname} collapsed={collapsed} />

        {/* 折叠/展开按钮 */}
        <div className={cn('border-t border-white/[0.08]', collapsed ? 'p-2' : 'p-3')}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'text-sidebar-foreground/60 hover:text-sidebar-foreground/60 hover:text-sidebar-accent-foreground hover:bg-white/10 rounded-xl transition-all duration-200',
              collapsed ? 'w-full justify-center p-2.5' : 'w-full justify-start'
            )}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} className="mr-2" />收起侧栏</>}
          </Button>
        </div>
      </aside>

      {/* 移动端汉堡菜单 */}
      <div className="lg:hidden fixed top-0 left-0 z-50 p-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="rounded-xl bg-white/80 backdrop-blur-sm shadow-sm">
              <Menu size={18} />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">导航菜单</SheetTitle>
            <div className="flex flex-col h-full bg-white">
              <NavContent isAdmin={isAdmin} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  )
}
