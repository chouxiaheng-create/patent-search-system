import Link from 'next/link'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  { label: '上传文件', href: (docId: string) => `/search/new/step-1?documentId=${docId}` },
  { label: '配置检索', href: (docId: string) => `/search/new/step-2?documentId=${docId}` },
  { label: '确认提交', href: (docId: string) => `/search/new/step-3?documentId=${docId}` },
]

interface WizardProgressProps {
  currentStep: 1 | 2 | 3
  /** 文档 ID，提供后步骤可点击跳转；历史任务页面可不传 */
  documentId?: string
}

export function WizardProgress({ currentStep, documentId }: WizardProgressProps) {
  return (
    <nav aria-label="检索向导进度" className="flex items-center justify-center mb-10">
      {STEPS.map((step, index) => {
        const n = index + 1
        const done = n < currentStep
        const active = n === currentStep
        const clickable = !!documentId && (done || n !== currentStep)

        const circle = (
          <span className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-all duration-300',
            done && 'bg-primary text-primary-foreground shadow-sm',
            active && 'bg-background text-primary ring-2 ring-primary ring-offset-2',
            !done && !active && 'bg-background text-muted-foreground ring-1 ring-muted-foreground/50',
            clickable && 'cursor-pointer hover:ring-primary hover:text-primary'
          )}>
            {done ? <Check size={14} strokeWidth={2.5} /> : n}
          </span>
        )

        return (
          <div key={step.label} className="flex items-center">
            <div className="flex items-center gap-2.5">
              {clickable ? (
                <Link href={step.href(documentId!)} className="flex items-center gap-2.5 no-underline">
                  {circle}
                  <span className="text-sm font-medium text-foreground hover:text-primary transition-colors">{step.label}</span>
                </Link>
              ) : (
                <>
                  {circle}
                  <span className={cn('text-sm font-medium transition-colors duration-200',
                    active && 'text-foreground',
                    done && 'text-foreground',
                    !done && !active && 'text-muted-foreground'
                  )}>{step.label}</span>
                </>
              )}
            </div>
            {index < STEPS.length - 1 && (
              <div className={cn(
                'h-px w-10 mx-4 transition-colors duration-300',
                done ? 'bg-primary' : 'bg-muted-foreground/50'
              )} />
            )}
          </div>
        )
      })}
    </nav>
  )
}