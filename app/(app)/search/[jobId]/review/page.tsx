'use client'

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { WizardProgress } from "@/components/wizard/wizard-progress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileText, Settings, Layers, Sliders, ArrowLeft, Eye, Loader2 } from "lucide-react"

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "排队中", variant: "secondary" },
  running: { label: "执行中", variant: "default" },
  completed: { label: "已完成", variant: "default" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
}

export default function ReviewPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string
  const supabase = createClient()

  const [job, setJob] = useState<Record<string, unknown> | null>(null)
  const [document, setDocument] = useState<Record<string, unknown> | null>(null)
  const [modelNames, setModelNames] = useState<Map<string, string>>(new Map())
  const [strategyNames, setStrategyNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const { data: jobData, error: jobError } = await supabase
        .from("search_jobs")
        .select("id, status, created_at, completed_at, config, document_id")
        .eq("id", jobId)
        .eq("user_id", user.id)
        .single()

      if (jobError || !jobData) {
        setError("任务不存在或无权访问")
        setLoading(false)
        return
      }

      const { data: docData } = await supabase
        .from("patent_documents")
        .select("id, title, file_type, parse_status, parsed_data, parse_config")
        .eq("id", jobData.document_id)
        .single()

      if (!docData) {
        setError("关联文档不存在")
        setLoading(false)
        return
      }

      const config = jobData.config as { model_ids: string[]; strategy_ids: string[]; report_model_id: string }
      const allModelIds = [...config.model_ids, config.report_model_id]
      const allStrategyIds = config.strategy_ids

      const [{ data: models }, { data: strategies }] = await Promise.all([
        allModelIds.length > 0
          ? supabase.from("ai_models").select("id, name").in("id", allModelIds)
          : { data: [] },
        allStrategyIds.length > 0
          ? supabase.from("search_strategies").select("id, name").in("id", allStrategyIds)
          : { data: [] },
      ])

      const mn = new Map<string, string>()
      ;(models || []).forEach((m: Record<string, unknown>) => mn.set(m.id as string, m.name as string))
      const sn = new Map<string, string>()
      ;(strategies || []).forEach((s: Record<string, unknown>) => sn.set(s.id as string, s.name as string))

      setJob(jobData)
      setDocument(docData)
      setModelNames(mn)
      setStrategyNames(sn)
      setLoading(false)
    }
    load()
  }, [jobId])

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>

  if (error || !job || !document) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-muted-foreground">{error || "加载失败"}</p>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>返回仪表盘</Button>
      </div>
    )
  }

  const config = job.config as Record<string, unknown>
  const status = statusConfig[job.status as string]
  const overrides = new Map(
    ((config.model_feature_overrides as Array<Record<string, unknown>>) ?? []).map((o: Record<string, unknown>) => [o.model_id as string, o])
  )
  const parseModelName = modelNames.get((document.parse_config as Record<string, string>)?.model_id ?? "") ?? "未知"
  const modelIds = (config.model_ids as string[]) || []
  const strategyIds = (config.strategy_ids as string[]) || []
  const parsedData = (document.parsed_data as Record<string, string>) || {}

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
          <ArrowLeft size={16} className="mr-1" /> 返回
        </Button>
        <h2 className="text-lg font-semibold text-foreground">{String(document.title ?? "")}</h2>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <WizardProgress currentStep={3} documentId={document.id as string} />

      <div className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><FileText size={16} /> 步骤 1 · 文档信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <InfoRow label="文档名称" value={String(document.title ?? "")} />
            <InfoRow label="文件类型" value={String(document.file_type ?? "").toUpperCase() || "-"} />
            <InfoRow label="解析模型" value={parseModelName} />
            <InfoRow label="解析状态" value={String(document.parse_status ?? "")} />
            {Object.keys(parsedData).filter(k => k !== "custom_fields").length > 0 && (
              <div className="mt-3 p-3 bg-muted rounded-lg">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">解析结果</p>
                <div className="space-y-1 text-sm">
                  {Object.entries(parsedData).filter(([k]) => k !== "custom_fields").map(([key, val]) => (
                    <InfoRow key={key} label={key} value={String(val || "-")} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Settings size={16} /> 步骤 2 · 检索配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Layers size={12} /> 检索平台（{modelIds.length} 个）
              </div>
              {modelIds.map((id: string) => {
                const o = overrides.get(id) as Record<string, unknown> | undefined
                return (
                  <div key={id} className="flex items-center gap-2">
                    <span className="text-sm font-medium">{modelNames.get(id) ?? id}</span>
                    {Boolean(o?.enable_thinking) && <Badge variant="secondary" className="text-[10px]">深度思考</Badge>}
                    {Boolean(o?.enable_web_search) && <Badge variant="secondary" className="text-[10px]">联网搜索</Badge>}
                  </div>
                )
              })}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <FileText size={12} /> 检索策略（{strategyIds.length} 个）
              </div>
              <div className="flex flex-wrap gap-1.5">
                {strategyIds.map((id: string) => (
                  <Badge key={id} variant="outline">{strategyNames.get(id) ?? id}</Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Sliders size={12} /> 参数配置
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">每路径备选文献数</p>
                  <p className="text-lg font-bold">{String(config.per_task_limit || "-")}</p>
                </div>
                <div className="bg-muted rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">报告输出文献数</p>
                  <p className="text-lg font-bold">{String(config.report_limit || "-")}</p>
                </div>
              </div>
              <div className="bg-muted rounded-xl p-3">
                <p className="text-xs text-muted-foreground">汇总模型</p>
                <p className="text-sm font-medium">{modelNames.get(config.report_model_id as string) ?? "未知"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Eye size={16} /> 步骤 3 · 提交信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <InfoRow label="创建时间" value={job.created_at ? new Date(job.created_at as string).toLocaleString("zh-CN") : "-"} />
            <InfoRow label="完成时间" value={job.completed_at ? new Date(job.completed_at as string).toLocaleString("zh-CN") : "-"} />
            <InfoRow label="子任务矩阵" value={modelIds.length + " × " + strategyIds.length + " = " + (modelIds.length * strategyIds.length) + " 条路径"} />
            {Boolean(config.report_system_prompt) && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">报告生成提示词</p>
                <div className="bg-muted rounded-xl p-3 text-xs text-foreground/70 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {String(config.report_system_prompt)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center gap-3 pt-2 pb-8">
          <Button variant="outline" onClick={() => router.push("/search/" + jobId + "/progress")}>
            查看执行进度
          </Button>
          {job.status === "completed" && (
            <Button onClick={() => router.push("/search/" + jobId + "/report")}>
              查看报告
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-muted-foreground shrink-0 min-w-[80px]">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}