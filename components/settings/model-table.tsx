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
                  <Badge variant="secondary" className="text-xs">内置</Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm text-slate-500">{model.model_id}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {model.usage_types.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">{USAGE_LABEL[t] ?? t}</Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                {model.capabilities.deep_reasoning && (
                  <Badge className="text-xs bg-purple-50 text-purple-700 border-purple-200">深度思考</Badge>
                )}
                {model.capabilities.web_search && (
                  <Badge className="text-xs bg-blue-50 text-blue-700 border-blue-200">联网搜索</Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              {model.api_key_encrypted ? (
                <span className="text-xs text-green-600 font-medium">已配置 ✓</span>
              ) : (
                <span className="text-xs text-slate-400">未配置</span>
              )}
            </TableCell>
            <TableCell>
              {model.is_builtin ? (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(model)} title="查看/配置 API Key">
                    <Lock size={14} />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(model)}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => onDelete(model)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
        {models.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-slate-400 py-8">暂无模型，点击右上角添加</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
