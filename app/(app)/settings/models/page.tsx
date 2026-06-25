'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModelTable } from '@/components/settings/model-table'
import { ModelFormDialog, type ModelFormData } from '@/components/settings/model-form-dialog'
import { toast } from 'sonner'
import type { AIModel } from '@/lib/supabase/types'

export default function ModelsSettingsPage() {
  const [models, setModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<AIModel | null>(null)

  async function loadModels() {
    const res = await fetch('/api/models')
    if (res.ok) setModels(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadModels() }, [])

  function handleAdd() {
    setEditingModel(null)
    setDialogOpen(true)
  }

  function handleEdit(model: AIModel) {
    setEditingModel(model)
    setDialogOpen(true)
  }

  async function handleDelete(model: AIModel) {
    if (!confirm(`确认删除模型「${model.name}」？此操作不可撤销。`)) return
    const res = await fetch(`/api/models/${model.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('模型已删除')
      setModels(prev => prev.filter(m => m.id !== model.id))
    } else {
      const data = await res.json()
      toast.error(data.error ?? '删除失败')
    }
  }

  async function handleSave(data: ModelFormData) {
    if (editingModel) {
      const body: Record<string, unknown> = {}
      if (data.api_key) body.api_key = data.api_key
      // 有 owner_id 的用户自定义模型可编辑全部字段
      if (editingModel.owner_id) {
        body.name = data.name
        body.api_base_url = data.api_base_url
        body.model_id = data.model_id
        body.usage_types = data.usage_types
        body.capabilities = data.capabilities
        body.adapter_config = data.adapter_config
      }
      const res = await fetch(`/api/models/${editingModel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        toast.success('模型已更新')
        await loadModels()
      } else {
        const err = await res.json()
        toast.error(err.error ?? '更新失败')
        throw new Error(err.error)
      }
    } else {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        toast.success('模型已添加')
        await loadModels()
      } else {
        const err = await res.json()
        toast.error(err.error ?? '添加失败')
        throw new Error(err.error)
      }
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">模型库</h1>
          <p className="text-sm text-muted-foreground mt-1">管理 AI 模型及 API Key。内置模型仅可配置 Key，自定义模型支持编辑全部参数。</p>
        </div>
        <Button onClick={handleAdd} className="flex items-center gap-2 rounded-xl">
          <Plus size={16} />添加自定义模型
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm font-medium">加载中...</span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-white/[0.08] overflow-hidden">
          <ModelTable models={models} onEdit={handleEdit} onDelete={handleDelete} />
        </div>
      )}

      <ModelFormDialog
        model={editingModel}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />
    </div>
  )
}
