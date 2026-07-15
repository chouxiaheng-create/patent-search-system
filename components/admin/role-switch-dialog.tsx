// components/admin/role-switch-dialog.tsx
// 角色切换对话框：要求输入"我确认"才允许提交。

'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Role = 'admin' | 'user'

export function RoleSwitchDialog({
  open, onOpenChange, currentRole, targetUserId, onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRole: Role
  targetUserId: string
  onSuccess: (newRole: Role) => void
}) {
  const nextRole: Role = currentRole === 'admin' ? 'user' : 'admin'
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (confirmText !== '我确认') {
      setError('请输入"我确认"以继续')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole, confirmText }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `请求失败 (${res.status})`)
      }
      onSuccess(nextRole)
      onOpenChange(false)
      setConfirmText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            切换角色：{currentRole === 'admin' ? '降级' : '升级'}为 {nextRole === 'admin' ? '管理员' : '普通用户'}
          </DialogTitle>
          <DialogDescription>
            这是一个重要操作，请输入 <strong>&quot;我确认&quot;</strong> 以继续。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='输入"我确认"'
            autoComplete="off"
            disabled={submitting}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || confirmText !== '我确认'}>
            {submitting ? '提交中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
