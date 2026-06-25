'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Pencil, Trash2, Lock } from 'lucide-react'
import type { AIModel } from '@/lib/supabase/types'

const USAGE_LABEL: Record<string, string> = {
  search: '检索', parse: '解析', report: '报告',
}

const PROVIDER_LABEL: Record<string, string> = {
  openai_compat: 'OpenAI 兼容', metaso: '秘塔AI',
}

interface ModelTableProps {
  models: AIModel[]
  onEdit: (model: AIModel) => void
  onDelete: (model: AIModel) => void
}

export function ModelTable({ models, onEdit, onDelete }: ModelTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>模型名称</TableHead>
          <TableHead>模型 ID</TableHead>
          <TableHead>协议</TableHead>
          <TableHead>用途</TableHead>
          <TableHead>能力</TableHead>
          <TableHead>API Key</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow key={model.id}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                {model.name}
                {model.is_builtin && (
                  <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground border-border">内置</Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm text-muted-foreground">{model.model_id}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{PROVIDER_LABEL[model.adapter_config?.provider] ?? model.adapter_config?.provider ?? '-'}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {model.usage_types.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs border-border text-muted-foreground">{USAGE_LABEL[t] ?? t}</Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                {model.capabilities.deep_reasoning && (
                  <Badge className="text-xs bg-[#af52de]/[0.08] text-[#af52de] border-[#af52de]/20">深度思考</Badge>
                )}
                {model.capabilities.web_search && (
                  <Badge className="text-xs bg-primary/10 text-primary border-primary/20">联网搜索</Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              {model.api_key_encrypted ? (
                <span className="text-xs text-emerald-600 font-medium">已配置 ✓</span>
              ) : (
                <span className="text-xs text-muted-foreground">未配置</span>
              )}
            </TableCell>
            <TableCell>
              {!model.owner_id ? (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="rounded-lg" onClick={() => onEdit(model)} title="配置 API Key">
                    <Lock size={14} />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="rounded-lg" onClick={() => onEdit(model)} title="编辑模型">
                    <Pencil size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" className="rounded-lg text-red-600 hover:text-red-600 hover:bg-red-50" onClick={() => onDelete(model)} title="删除模型">
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
        {models.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无模型，点击右上角添加</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
