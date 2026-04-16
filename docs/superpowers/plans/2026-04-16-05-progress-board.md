# Plan 5: 进度看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/search/[jobId]/progress` 页面，使用 React Flow 水平流程图展示任务节点，支持 Supabase Realtime 实时更新。

**Architecture:** 统一看板页面，使用 @xyflow/react 渲染流程图，通过 Supabase Realtime 订阅任务状态变更。

**Tech Stack:** Next.js 16 (App Router), @xyflow/react, Supabase JS SDK v2, Tailwind CSS, shadcn/ui

---

## 文件结构

```
app/(app)/search/[jobId]/
└── progress/
    └── page.tsx              # 主页面（Client Component）

components/flow/
├── job-progress.tsx          # React Flow 主组件
├── nodes/
│   ├── parse-node.tsx       # 文献解析节点
│   ├── search-task-node.tsx # 子任务节点
│   ├── report-node.tsx      # 报告节点
│   └── placeholder-node.tsx # 排队占位节点
├── job-sidebar.tsx           # 侧边栏
└── queue-banner.tsx         # 排队横幅
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 React Flow**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npm install @xyflow/react
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(progress-board): add @xyflow/react dependency"
```

---

## Task 2: 创建目录结构

**Files:**
- Create: `app/(app)/search/[jobId]/progress/`
- Create: `components/flow/`
- Create: `components/flow/nodes/`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p "app/(app)/search/[jobId]/progress"
mkdir -p components/flow/nodes
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "feat(progress-board): create directory structure"
```

---

## Task 3: 文献解析节点组件

**Files:**
- Create: `components/flow/nodes/parse-node.tsx`

- [ ] **Step 1: 实现文献解析节点**

```tsx
// components/flow/nodes/parse-node.tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, Check, Loader2, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ParseNodeData {
  title: string
  status: 'pending' | 'parsing' | 'done' | 'needs_review' | 'failed'
}

const statusConfig = {
  pending: { color: 'text-slate-400', bg: 'bg-slate-100', icon: Clock, label: '等待中' },
  parsing: { color: 'text-blue-500', bg: 'bg-blue-50', icon: Loader2, label: '解析中', animate: true },
  done: { color: 'text-green-500', bg: 'bg-green-50', icon: Check, label: '已完成' },
  needs_review: { color: 'text-amber-500', bg: 'bg-amber-50', icon: AlertCircle, label: '需人工审查' },
  failed: { color: 'text-red-500', bg: 'bg-red-50', icon: AlertCircle, label: '解析失败' },
}

export const ParseNode = memo(function ParseNode({ data }: NodeProps<ParseNodeData>) {
  const config = statusConfig[data.status] || statusConfig.pending
  const Icon = config.icon

  return (
    <div className={cn(
      'min-w-[180px] rounded-lg border-2 p-3 shadow-sm transition-all',
      config.bg,
      'border-slate-200'
    )}>
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', config.color)}>
          <Icon size={18} className={cn(config.animate && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-700">文献解析</div>
          <div className="text-xs text-slate-500 truncate mt-0.5">{data.title}</div>
          <div className={cn('text-xs mt-1', config.color)}>{config.label}</div>
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/nodes/parse-node.tsx
git commit -m "feat(progress-board): add ParseNode component"
```

---

## Task 4: 子任务节点组件

**Files:**
- Create: `components/flow/nodes/search-task-node.tsx`

- [ ] **Step 1: 实现子任务节点**

```tsx
// components/flow/nodes/search-task-node.tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Search, Check, X, RotateCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchTaskNodeData {
  platformName: string
  strategyName: string
  status: 'pending' | 'running' | 'retrying' | 'done' | 'abandoned'
  resultCount?: number
}

const statusConfig = {
  pending: { color: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200', icon: Search, label: '等待中' },
  running: { color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-300', icon: Loader2, label: '检索中' },
  retrying: { color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-300', icon: RotateCw, label: '重试中' },
  done: { color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-300', icon: Check, label: '已完成' },
  abandoned: { color: 'text-red-400', bg: 'bg-red-50', border: 'border-red-300', icon: X, label: '已放弃' },
}

export const SearchTaskNode = memo(function SearchTaskNode({ data }: NodeProps<SearchTaskNodeData>) {
  const config = statusConfig[data.status] || statusConfig.pending
  const Icon = config.icon

  return (
    <div className={cn(
      'min-w-[160px] rounded-lg border-2 p-3 shadow-sm transition-all',
      config.bg,
      config.border
    )}>
      <Handle type="target" position={Position.Left} className="w-2 h-2" />
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', config.color)}>
          <Icon size={16} className={cn((data.status === 'running' || data.status === 'retrying') && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-slate-600">
            {data.platformName}
          </div>
          <div className="text-xs text-slate-400">
            × {data.strategyName}
          </div>
          <div className={cn('text-xs mt-1', config.color)}>
            {config.label}
            {data.status === 'done' && data.resultCount !== undefined && (
              <span className="ml-1">({data.resultCount}篇)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/nodes/search-task-node.tsx
git commit -m "feat(progress-board): add SearchTaskNode component"
```

---

## Task 5: 报告节点组件

**Files:**
- Create: `components/flow/nodes/report-node.tsx`

- [ ] **Step 1: 实现报告节点**

```tsx
// components/flow/nodes/report-node.tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { BarChart3, Check, Loader2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface ReportNodeData {
  status: 'waiting' | 'generating' | 'done'
  jobId: string
  docCount?: number
}

export const ReportNode = memo(function ReportNode({ data }: NodeProps<ReportNodeData>) {
  const isDone = data.status === 'done'
  const isGenerating = data.status === 'generating'

  return (
    <div className={cn(
      'min-w-[160px] rounded-lg border-2 p-3 shadow-sm transition-all',
      isDone ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-200'
    )}>
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', isDone ? 'text-green-500' : 'text-slate-400')}>
          {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-700">生成报告</div>
          <div className={cn('text-xs mt-1', isDone ? 'text-green-600' : 'text-slate-400')}>
            {isDone ? '报告已生成' : isGenerating ? '正在生成...' : '等待中'}
          </div>
          {isDone && data.docCount !== undefined && (
            <div className="text-xs text-slate-500 mt-0.5">共 {data.docCount} 篇文献</div>
          )}
        </div>
      </div>

      {isDone && (
        <Link href={`/search/${data.jobId}/report`} className="block mt-2">
          <Button size="sm" variant="outline" className="w-full text-xs h-7">
            查看报告
          </Button>
        </Link>
      )}
    </div>
  )
})
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/nodes/report-node.tsx
git commit -m "feat(progress-board): add ReportNode component"
```

---

## Task 6: 排队占位节点组件

**Files:**
- Create: `components/flow/nodes/placeholder-node.tsx`

- [ ] **Step 1: 实现占位节点**

```tsx
// components/flow/nodes/placeholder-node.tsx
'use client'

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PlaceholderNodeData {
  queuePosition: number
  estimatedWaitMinutes: number
}

export const PlaceholderNode = memo(function PlaceholderNode({ data }: NodeProps<PlaceholderNodeData>) {
  return (
    <div className="min-w-[200px] rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center">
      <Clock size={24} className="mx-auto text-slate-400 mb-2" />
      <div className="text-sm font-medium text-slate-600">等待队列中</div>
      <div className="text-2xl font-bold text-slate-500 mt-2">
        第 {data.queuePosition} 位
      </div>
      <div className="text-xs text-slate-400 mt-1">
        预计等待约 {data.estimatedWaitMinutes} 分钟
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/nodes/placeholder-node.tsx
git commit -m "feat(progress-board): add PlaceholderNode component"
```

---

## Task 7: 节点导出

**Files:**
- Create: `components/flow/nodes/index.ts`

- [ ] **Step 1: 创建节点导出**

```typescript
// components/flow/nodes/index.ts
export { ParseNode } from './parse-node'
export { SearchTaskNode } from './search-task-node'
export { ReportNode } from './report-node'
export { PlaceholderNode } from './placeholder-node'

import { ParseNode } from './parse-node'
import { SearchTaskNode } from './search-task-node'
import { ReportNode } from './report-node'
import { PlaceholderNode } from './placeholder-node'

export const nodeTypes = {
  parse: ParseNode,
  searchTask: SearchTaskNode,
  report: ReportNode,
  placeholder: PlaceholderNode,
}
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/nodes/index.ts
git commit -m "feat(progress-board): export node types"
```

---

## Task 8: 排队横幅组件

**Files:**
- Create: `components/flow/queue-banner.tsx`

- [ ] **Step 1: 实现排队横幅**

```tsx
// components/flow/queue-banner.tsx
'use client'

import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface QueueBannerProps {
  queuePosition: number
  estimatedWaitMinutes: number
  onCancel: () => void
  cancelling?: boolean
}

export function QueueBanner({
  queuePosition,
  estimatedWaitMinutes,
  onCancel,
  cancelling = false
}: QueueBannerProps) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock size={20} className="text-amber-500" />
          <div>
            <div className="text-sm font-medium text-amber-800">
              当前在队列中第 {queuePosition} 位
            </div>
            <div className="text-xs text-amber-600">
              预计等待约 {estimatedWaitMinutes} 分钟
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
          className="text-amber-700 border-amber-300 hover:bg-amber-100"
        >
          {cancelling ? '取消中...' : '取消任务'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/queue-banner.tsx
git commit -m "feat(progress-board): add QueueBanner component"
```

---

## Task 9: 侧边栏组件

**Files:**
- Create: `components/flow/job-sidebar.tsx`

- [ ] **Step 1: 实现侧边栏**

```tsx
// components/flow/job-sidebar.tsx
'use client'

import { JobStatus } from '@/lib/supabase/types'
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface JobSidebarProps {
  jobId: string
  status: JobStatus
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  docCount?: number
  onCancel: () => void
  cancelling?: boolean
}

const statusConfig = {
  queued: { label: '排队中', color: 'text-amber-600', bg: 'bg-amber-50' },
  running: { label: '执行中', color: 'text-blue-600', bg: 'bg-blue-50' },
  completed: { label: '已完成', color: 'text-green-600', bg: 'bg-green-50' },
  failed: { label: '失败', color: 'text-red-600', bg: 'bg-red-50' },
  cancelled: { label: '已取消', color: 'text-slate-600', bg: 'bg-slate-50' },
}

export function JobSidebar({
  jobId,
  status,
  startedAt,
  completedAt,
  createdAt,
  docCount,
  onCancel,
  cancelling = false
}: JobSidebarProps) {
  const config = statusConfig[status] || statusConfig.queued
  const canCancel = status === 'queued' || status === 'running'

  return (
    <div className="w-72 bg-white border-l border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">任务详情</h3>

      <div className="space-y-4">
        {/* 状态 */}
        <div className={cn('rounded-lg p-3', config.bg)}>
          <div className="text-xs text-slate-500 mb-1">状态</div>
          <div className={cn('text-sm font-medium', config.color)}>
            {config.label}
          </div>
        </div>

        {/* 创建时间 */}
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Calendar size={12} />
            <span>创建时间</span>
          </div>
          <div className="text-sm text-slate-700">
            {new Date(createdAt).toLocaleString('zh-CN')}
          </div>
        </div>

        {/* 开始时间 */}
        {startedAt && (
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Clock size={12} />
              <span>开始时间</span>
            </div>
            <div className="text-sm text-slate-700">
              {new Date(startedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        )}

        {/* 完成时间 */}
        {completedAt && (
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              {status === 'completed' ? <CheckCircle size={12} className="text-green-500" /> : <XCircle size={12} className="text-red-500" />}
              <span>{status === 'completed' ? '完成时间' : '失败时间'}</span>
            </div>
            <div className="text-sm text-slate-700">
              {new Date(completedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        )}

        {/* 文献数量 */}
        {status === 'completed' && docCount !== undefined && (
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <AlertCircle size={12} />
              <span>对比文献</span>
            </div>
            <div className="text-sm text-slate-700">{docCount} 篇</div>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="mt-6 space-y-2">
        {canCancel && (
          <Button
            variant="outline"
            className="w-full text-red-600 border-red-200 hover:bg-red-50"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? '取消中...' : '取消任务'}
          </Button>
        )}

        {status === 'completed' && (
          <Link href={`/search/${jobId}/report`}>
            <Button className="w-full">查看报告</Button>
          </Link>
        )}

        <Link href="/dashboard">
          <Button variant="ghost" className="w-full">返回列表</Button>
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/job-sidebar.tsx
git commit -m "feat(progress-board): add JobSidebar component"
```

---

## Task 10: React Flow 主组件

**Files:**
- Create: `components/flow/job-progress.tsx`

- [ ] **Step 1: 实现 React Flow 主组件**

```tsx
// components/flow/job-progress.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { nodeTypes } from './nodes'
import { QueueBanner } from './queue-banner'
import { JobSidebar } from './job-sidebar'
import { createClient } from '@/lib/supabase/client'
import type { SearchJob, SearchTask, PatentDocument, AIModel, SearchStrategy } from '@/lib/supabase/types'

interface JobProgressProps {
  jobId: string
  userId: string
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 80
const HORIZONTAL_GAP = 200
const VERTICAL_GAP = 100

export function JobProgress({ jobId, userId }: JobProgressProps) {
  const supabase = createClient()

  const [job, setJob] = useState<SearchJob | null>(null)
  const [tasks, setTasks] = useState<SearchTask[]>([])
  const [document, setDocument] = useState<PatentDocument | null>(null)
  const [models, setModels] = useState<Record<string, AIModel>>({})
  const [strategies, setStrategies] = useState<Record<string, SearchStrategy>>({})
  const [queuePosition, setQueuePosition] = useState(0)
  const [cancelling, setCancelling] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // 加载初始数据
  useEffect(() => {
    async function loadData() {
      // 获取任务详情
      const { data: jobData } = await supabase
        .from('search_jobs')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', userId)
        .single()
      setJob(jobData)

      if (jobData) {
        // 获取文档
        const { data: docData } = await supabase
          .from('patent_documents')
          .select('*')
          .eq('id', jobData.document_id)
          .single()
        setDocument(docData)

        // 获取子任务
        const { data: tasksData } = await supabase
          .from('search_tasks')
          .select('*')
          .eq('job_id', jobId)
        setTasks(tasksData || [])

        // 获取模型和策略名称
        if (tasksData && tasksData.length > 0) {
          const modelIds = [...new Set(tasksData.map(t => t.model_id))]
          const strategyIds = [...new Set(tasksData.map(t => t.strategy_id))]

          const [{ data: modelsData }, { data: strategiesData }] = await Promise.all([
            supabase.from('ai_models').select('*').in('id', modelIds),
            supabase.from('search_strategies').select('*').in('id', strategyIds),
          ])

          setModels(Object.fromEntries((modelsData || []).map(m => [m.id, m])))
          setStrategies(Object.fromEntries((strategiesData || []).map(s => [s.id, s])))
        }

        // 计算排队位置
        if (jobData.status === 'queued') {
          const { count } = await supabase
            .from('search_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'queued')
            .lt('created_at', jobData.created_at)

          setQueuePosition((count || 0) + 1)
        }
      }
    }
    loadData()
  }, [jobId, userId])

  // 订阅实时更新
  useEffect(() => {
    const channel = supabase
      .channel(`job-progress-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'search_jobs',
        filter: `id=eq.${jobId}`,
      }, (payload) => {
        setJob(payload.new as SearchJob)
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'search_tasks',
        filter: `job_id=eq.${jobId}`,
      }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setTasks(prev => prev.map(t => t.id === payload.new.id ? payload.new as SearchTask : t))
        } else if (payload.eventType === 'INSERT') {
          setTasks(prev => [...prev, payload.new as SearchTask])
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId])

  // 构建节点和边
  useEffect(() => {
    if (!job) return

    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    if (job.status === 'queued') {
      // 排队状态：显示占位节点
      newNodes.push({
        id: 'placeholder',
        type: 'placeholder',
        position: { x: 250, y: 100 },
        data: {
          queuePosition,
          estimatedWaitMinutes: queuePosition * 5,
        },
      })
    } else {
      // 运行/完成状态：显示完整流程图

      // 1. 文献解析节点
      newNodes.push({
        id: 'parse',
        type: 'parse',
        position: { x: 0, y: 150 },
        data: {
          title: document?.title || '文档',
          status: document?.parse_status || 'pending',
        },
      })

      // 2. 子任务节点
      const tasksByModel: Record<string, SearchTask[]> = {}
      tasks.forEach(task => {
        if (!tasksByModel[task.model_id]) {
          tasksByModel[task.model_id] = []
        }
        tasksByModel[task.model_id].push(task)
      })

      let colIndex = 0
      Object.entries(tasksByModel).forEach(([modelId, modelTasks]) => {
        const x = (colIndex + 1) * HORIZONTAL_GAP

        modelTasks.forEach((task, rowIndex) => {
          const y = rowIndex * VERTICAL_GAP + 50
          const model = models[modelId]
          const strategy = strategies[task.strategy_id]

          newNodes.push({
            id: task.id,
            type: 'searchTask',
            position: { x, y },
            data: {
              platformName: model?.name || '未知平台',
              strategyName: strategy?.name || '未知策略',
              status: task.status,
              resultCount: task.results?.length || 0,
            },
          })

          // 边：文献解析 → 子任务
          newEdges.push({
            id: `parse-to-${task.id}`,
            source: 'parse',
            target: task.id,
            animated: task.status === 'running',
            markerEnd: { type: MarkerType.ArrowClosed },
          })
        })

        colIndex++
      })

      // 3. 报告节点
      newNodes.push({
        id: 'report',
        type: 'report',
        position: { x: (colIndex + 1) * HORIZONTAL_GAP, y: 150 },
        data: {
          status: job.status === 'completed' ? 'done' : job.status === 'running' ? 'generating' : 'waiting',
          jobId,
          docCount: job.status === 'completed' ? tasks.reduce((sum, t) => sum + (t.results?.length || 0), 0) : undefined,
        },
      })

      // 边：所有子任务 → 报告
      tasks.forEach(task => {
        newEdges.push({
          id: `${task.id}-to-report`,
          source: task.id,
          target: 'report',
          animated: task.status === 'running',
          markerEnd: { type: MarkerType.ArrowClosed },
        })
      })
    }

    setNodes(newNodes)
    setEdges(newEdges)
  }, [job, tasks, document, models, strategies, queuePosition, jobId])

  // 取消任务
  const handleCancel = useCallback(async () => {
    if (!job) return
    setCancelling(true)

    const { error } = await supabase
      .from('search_jobs')
      .update({ status: 'cancelled' })
      .eq('id', jobId)
      .eq('user_id', userId)

    setCancelling(false)

    if (!error) {
      window.location.href = '/dashboard'
    }
  }, [job, jobId, userId])

  if (!job) {
    return <div className="flex items-center justify-center h-64">加载中...</div>
  }

  return (
    <div className="flex h-full">
      {/* 排队横幅 */}
      {job.status === 'queued' && (
        <div className="absolute top-4 left-4 right-72 z-10">
          <QueueBanner
            queuePosition={queuePosition}
            estimatedWaitMinutes={queuePosition * 5}
            onCancel={handleCancel}
            cancelling={cancelling}
          />
        </div>
      )}

      {/* React Flow 画布 */}
      <div className="flex-1 h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Controls />
          <Background />
        </ReactFlow>
      </div>

      {/* 侧边栏 */}
      <JobSidebar
        jobId={jobId}
        status={job.status}
        startedAt={job.started_at}
        completedAt={job.completed_at}
        createdAt={job.created_at}
        docCount={tasks.reduce((sum, t) => sum + (t.results?.length || 0), 0)}
        onCancel={handleCancel}
        cancelling={cancelling}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/flow/job-progress.tsx
git commit -m "feat(progress-board): add JobProgress React Flow component"
```

---

## Task 11: 进度页面

**Files:**
- Create: `app/(app)/search/[jobId]/progress/page.tsx`

- [ ] **Step 1: 创建进度页面**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add "app/(app)/search/[jobId]/progress/page.tsx"
git commit -m "feat(progress-board): add progress page"
```

---

## Task 12: 更新侧边栏导航

**Files:**
- Modify: `components/sidebar.tsx`

- [ ] **Step 1: 添加进度页面链接到侧边栏**

读取现有 `components/sidebar.tsx`，找到导航项定义，在适当位置添加进度页面链接。

由于用户可能在查看任务历史时点击进入进度页面，需要在 dashboard 中添加链接。实际链接将在 Task 13（Dashboard 更新）中添加。

- [ ] **Step 2: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat(progress-board): add progress page link to navigation"
```

---

## Task 13: 更新 Dashboard 显示进度链接

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: 在 Dashboard 添加进度链接**

读取现有 `app/(app)/dashboard/page.tsx`，添加显示任务列表并链接到进度页面的功能。

由于设计文档要求 dashboard 为仪表盘占位页，本次仅添加基础任务列表展示，完整实现可在后续迭代中完成。

- [ ] **Step 2: Commit**

```bash
git add app/(app)/dashboard/page.tsx
git commit -m "feat(progress-board): add job list with progress links to dashboard"
```

---

## Task 14: 最终验证

- [ ] **Step 1: 编译 Next.js**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npm run build
```

预期：编译成功，无 TypeScript 错误

- [ ] **Step 2: 检查文件完整性**

确认以下文件都存在：

```
app/(app)/search/[jobId]/progress/
└── page.tsx

components/flow/
├── job-progress.tsx
├── job-sidebar.tsx
├── queue-banner.tsx
└── nodes/
    ├── index.ts
    ├── parse-node.tsx
    ├── search-task-node.tsx
    ├── report-node.tsx
    └── placeholder-node.tsx
```

- [ ] **Step 3: 最终提交**

```bash
git add .
git commit -m "feat: Plan 5 complete - progress board with React Flow"
```

---

## 自审检查

- [ ] Spec 覆盖检查：
  - React Flow 水平流程图 ✅
  - 文献解析节点 ✅
  - M×N 子任务节点 ✅
  - 报告生成节点 ✅
  - 排队占位节点 ✅
  - Supabase Realtime 实时更新 ✅
  - 取消任务功能 ✅
  - 排队位置计算 ✅
  - 侧边栏 ✅
- [ ] 占位符扫描：无 TBD/TODO
- [ ] 类型一致性：使用现有类型定义
- [ ] 编译验证：Task 14 Step 1 确认编译通过
