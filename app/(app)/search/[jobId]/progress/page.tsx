// app/(app)/search/[jobId]/progress/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { JobProgress } from '@/components/flow/job-progress'

export default function ProgressPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string
  const supabase = createClient()

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)
      setLoading(false)
    }
    checkAuth()
  }, [router])

  if (loading || !userId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-sm font-medium">加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => router.push('/search/' + jobId + '/review')}>
          查看配置
        </Button>
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>返回列表</Button>
      </div>
      <div className="flex-1 min-h-0">
        <JobProgress jobId={jobId} userId={userId} />
      </div>
    </div>
  )
}