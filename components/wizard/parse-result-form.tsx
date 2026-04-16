'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { PatentDocument } from '@/lib/supabase/types'

interface ParseResultFormProps {
  document: PatentDocument
  onSave: (updates: { parsed_data: PatentDocument['parsed_data']; user_notes: string }) => Promise<void>
}

export function ParseResultForm({ document, onSave }: ParseResultFormProps) {
  const pd = document.parsed_data ?? {}
  const [techTheme, setTechTheme] = useState(pd.tech_theme ?? '')
  const [applicant, setApplicant] = useState(pd.applicant ?? '')
  const [inventor, setInventor] = useState(pd.inventor ?? '')
  const [filingDate, setFilingDate] = useState(pd.filing_date ?? '')
  const [coreInvention, setCoreInvention] = useState(pd.core_invention ?? '')
  const [mainTechSteps, setMainTechSteps] = useState(pd.main_tech_steps ?? '')
  const [userNotes, setUserNotes] = useState(document.user_notes ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const mark = () => setDirty(true)

  async function handleSave() {
    setSaving(true)
    await onSave({
      parsed_data: { tech_theme: techTheme, applicant, inventor, filing_date: filingDate, core_invention: coreInvention, main_tech_steps: mainTechSteps, custom_fields: pd.custom_fields },
      user_notes: userNotes,
    })
    setDirty(false)
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {document.quality_warning && (
        <div className="flex items-start gap-2 px-4 py-3 bg-orange-50 border border-orange-200 rounded-md text-orange-800 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>文件排版复杂，解析结果可能不准确，建议逐项核对并在备注栏补充说明</span>
        </div>
      )}
      {document.parse_status === 'done' && !document.quality_warning && (
        <div className="flex items-center gap-2 text-green-700 text-sm">
          <CheckCircle2 size={16} /><span>解析完成，请确认以下字段</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1"><Label htmlFor="tech-theme">技术主题</Label><Input id="tech-theme" value={techTheme} onChange={e => { setTechTheme(e.target.value); mark() }} /></div>
        <div className="space-y-1"><Label htmlFor="applicant">申请人</Label><Input id="applicant" value={applicant} onChange={e => { setApplicant(e.target.value); mark() }} /></div>
        <div className="space-y-1"><Label htmlFor="inventor">发明人</Label><Input id="inventor" value={inventor} onChange={e => { setInventor(e.target.value); mark() }} /></div>
        <div className="space-y-1"><Label htmlFor="filing-date">申请日</Label><Input id="filing-date" value={filingDate} placeholder="YYYY-MM-DD" onChange={e => { setFilingDate(e.target.value); mark() }} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor="core-invention">核心发明构思</Label><Textarea id="core-invention" value={coreInvention} rows={3} onChange={e => { setCoreInvention(e.target.value); mark() }} /></div>
      <div className="space-y-1"><Label htmlFor="main-tech-steps">主要技术方案步骤</Label><Textarea id="main-tech-steps" value={mainTechSteps} rows={3} onChange={e => { setMainTechSteps(e.target.value); mark() }} /></div>
      <div className="space-y-1"><Label htmlFor="user-notes">备注</Label><Textarea id="user-notes" value={userNotes} rows={2} placeholder="补充说明..." onChange={e => { setUserNotes(e.target.value); mark() }} /></div>
      {dirty && <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存修改'}</Button>}
    </div>
  )
}
