import { forwardRef } from 'react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from './tooltip'

type ButtonChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  as?: 'button'
}

type AnchorChipProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  as: 'a'
}

type ActionChipProps = (ButtonChipProps | AnchorChipProps) & {
  active?: boolean
  tooltip?: React.ReactNode
}

const BASE =
  'inline-flex items-center gap-1 border border-border rounded px-2 py-0.5 text-[13px] transition-colors'

export const ActionChip = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ActionChipProps
>(function ActionChip({ active = false, tooltip, className, children, ...rest }, ref) {
  const colorClass = active ? 'text-accent' : 'text-muted hover:text-accent'
  const cls = `${BASE} ${colorClass}${className ? ` ${className}` : ''}`

  const element = rest.as === 'a' ? (() => {
    const { as: _, ...anchorProps } = rest as AnchorChipProps
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        className={cls}
        {...anchorProps}
      >
        {children}
      </a>
    )
  })() : (() => {
    const { as: _, ...buttonProps } = rest as ButtonChipProps
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cls}
        {...buttonProps}
      >
        {children}
      </button>
    )
  })()

  if (!tooltip) return element

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {element}
      </TooltipTrigger>
      <TooltipContent className="hidden sm:block">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
})
