export const nodeStyle = (active: boolean, current: boolean, isDecision: boolean) => ({
  fontFamily: 'inherit', fontSize: 12, position: 'relative' as const, width: 240, cursor: 'pointer',
  background: 'var(--color-base-200, #1e293b)', color: 'var(--color-base-content, #e2e8f0)',
  borderRadius: 8, padding: '10px 16px', opacity: current || active ? 1 : 0.5,
  border: current ? '2px solid var(--color-primary, #3b82f6)'
    : active ? '2px solid color-mix(in oklch, var(--color-base-content, #e2e8f0) 50%, transparent)'
    : isDecision ? '2px solid var(--color-warning, #f59e0b)'
    : '1px solid color-mix(in oklch, var(--color-base-content, #e2e8f0) 15%, transparent)',
})

export const handleStyle = { width: 8, height: 8, background: 'color-mix(in oklch, var(--color-base-content, #e2e8f0) 40%, transparent)', border: 'none' }
export const barStyle = (c: string) => ({ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 3, borderRadius: '8px 8px 0 0', background: c })
export const dotStyle = { width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary, #3b82f6)', flexShrink: 0 as const }
export const TASK_ICONS: Record<string, string> = { data: 'FileText', upload: 'Upload', extract: 'Search', generate: 'FilePlus', manual: 'CheckSquare' }
