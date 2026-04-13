// components/header.tsx
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface HeaderProps {
  displayName: string | null
  unreadCount?: number
}

export function Header({ displayName, unreadCount = 0 }: HeaderProps) {
  const initials = displayName
    ? displayName.slice(0, 1).toUpperCase()
    : '?'

  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-end px-6 gap-3">
      <Button variant="ghost" size="icon" className="relative">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Button>
      <Avatar className="w-8 h-8">
        <AvatarFallback className="bg-blue-100 text-blue-700 text-sm">
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm text-slate-600">{displayName ?? '用户'}</span>
    </header>
  )
}
