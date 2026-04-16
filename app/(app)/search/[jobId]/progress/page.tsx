// app/(app)/search/[jobId]/progress/page.tsx
'use client'

import { useEffect, useState } from 'react'
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
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-8rem)]">
      <JobProgress jobId={jobId} userId={userId} />
    </div>
  )
}
