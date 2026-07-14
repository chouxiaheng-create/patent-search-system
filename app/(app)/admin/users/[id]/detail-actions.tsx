// app/(app)/admin/users/[id]/detail-actions.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RoleSwitchDialog } from '@/components/admin/role-switch-dialog'

export function DetailActions({
  userId, currentRole,
}: { userId: string; currentRole: 'admin' | 'user' }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(currentRole)
  const router = useRouter()
  const [, startTransition] = useTransition()

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        切换为{role === 'admin' ? '普通用户' : '管理员'}
      </Button>
      <RoleSwitchDialog
        open={open}
        onOpenChange={setOpen}
        currentRole={role}
        targetUserId={userId}
        onSuccess={(newRole) => {
          setRole(newRole)
          startTransition(() => router.refresh())
        }}
      />
    </>
  )
}
