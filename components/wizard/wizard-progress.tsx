import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [{ label: '上传文件' }, { label: '配置检索' }, { label: '确认提交' }]

export function WizardProgress({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  return (
    <nav aria-label="检索向导进度" className="flex items-center mb-8">
      {STEPS.map((step, index) => {
        const n = index + 1
        const done = n < currentStep
        const active = n === currentStep
        return (
          <div key={step.label} className="flex items-center">
            <div className="flex items-center gap-2">
              <span className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium border-2 shrink-0',
                done && 'bg-blue-600 border-blue-600 text-white',
                active && 'bg-white border-blue-600 text-blue-600',
                !done && !active && 'bg-white border-slate-300 text-slate-400'
              )}>
                {done ? <Check size={14} /> : n}
              </span>
              <span className={cn('text-sm font-medium',
                active && 'text-blue-600', done && 'text-slate-700', !done && !active && 'text-slate-400'
              )}>{step.label}</span>
            </div>
            {index < STEPS.length - 1 && (
              <div className={cn('h-px w-12 mx-3', n < currentStep ? 'bg-blue-600' : 'bg-slate-200')} />
            )}
          </div>
        )
      })}
    </nav>
  )
}
