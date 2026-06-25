import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'
import type { FileType } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileUrl, fileName, fileType, parseModelId, parseSystemPrompt } = await request.json() as {
    fileUrl: string; fileName: string; fileType: FileType
    parseModelId: string; parseSystemPrompt: string
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('patent_documents')
    .insert({
      user_id: user.id, title: fileName, file_url: fileUrl, file_type: fileType,
      parse_status: 'pending',
      parse_config: { model_id: parseModelId, system_prompt: parseSystemPrompt },
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  await sendBossJob('parse-job', { documentId: data.id, parseModelId, parseSystemPrompt })

  return Response.json({ documentId: data.id }, { status: 201 })
}
