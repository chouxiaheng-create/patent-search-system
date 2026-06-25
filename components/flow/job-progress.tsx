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
  type NodeTypes,
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

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
          setTasks(prev => {
            if (prev.some(t => t.id === payload.new.id)) return prev
            return [...prev, payload.new as SearchTask]
          })
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
              startedAt: task.started_at,
              completedAt: task.completed_at,
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
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-sm font-medium">加载中...</span>
        </div>
      </div>
    )
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
          nodeTypes={nodeTypes as unknown as NodeTypes}
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