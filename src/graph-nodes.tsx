import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { TaskDef } from '../../../packages/workflow-engine/src/engine'
import { nodeStyle, handleStyle, barStyle, dotStyle, TASK_ICONS } from './styles'
import type { CrmStore, Hooks } from './hooks'
import type { ComponentType } from 'react'

export function createGraphNodes(icons: Record<string, ComponentType<{ size?: number }>>, useCrm: CrmStore, hooks: Hooks) {
  const getIcon = (name: string): ComponentType<{ size?: number }> => (icons as Record<string, ComponentType<{ size?: number }>>)[name] ?? icons.CheckSquare

  function GStageNode({ id, data }: NodeProps) {
    const isActive = id === useCrm(s => s.activeNodeId)
    const isCurrent = hooks.useCurrentCase()?.data?.currentStage === id
    const cl = (data.checklist as TaskDef[]) || []
    const counts: Record<string, number> = {}
    for (const c of cl) counts[c.type] = (counts[c.type] || 0) + 1
    const types = ['data', 'upload', 'extract', 'generate'].filter(t => counts[t])
    return (
      <div style={nodeStyle(isActive, isCurrent, false)} onClick={() => useCrm.setState({ activeNodeId: id })}>
        <div style={barStyle((data.color as string) || '#3b82f6')} />
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isCurrent && <span style={dotStyle} />}{data.label as string}
        </div>
        {data.description && <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>{data.description as string}</div>}
        {types.length > 0 && <div style={{ fontSize: 9, opacity: 0.5, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
          {types.map(t => { const I = getIcon(TASK_ICONS[t] || 'CheckSquare'); return <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 2 }}><I size={10} />{counts[t]}</span> })}
        </div>}
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      </div>
    )
  }

  function GDecisionNode({ id, data }: NodeProps) {
    const isCurrent = hooks.useCurrentCase()?.data?.currentStage === id
    return (
      <div style={nodeStyle(id === useCrm(s => s.activeNodeId), isCurrent, true)} onClick={() => useCrm.setState({ activeNodeId: id })}>
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={{ fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {isCurrent && <span style={dotStyle} />}{data.label as string}
        </div>
        <Handle type="source" position={Position.Bottom} id="yes" style={{ ...handleStyle, left: '30%' }} />
        <Handle type="source" position={Position.Bottom} id="no" style={{ ...handleStyle, left: '70%' }} />
      </div>
    )
  }

  return { stage: GStageNode, decision: GDecisionNode }
}
