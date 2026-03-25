import { ReactFlow } from '@xyflow/react'
import type { PluginDeps, PostRecord } from '../../plugin-types'
import { getStageView } from '../../../packages/workflow-engine/src/engine'
import type { CrmStore, Hooks } from './hooks'
import type { Actions } from './actions'
import type { ComponentType, ReactNode } from 'react'

interface DefaultViewProps { title: string; subtitle?: string; subtitleBelow?: boolean; top?: ReactNode; bottom?: ReactNode }

export function createPanels(
  deps: PluginDeps,
  hooks: Hooks,
  actions: Actions,
  useCrm: CrmStore,
  graphNodeTypes: Record<string, ComponentType<unknown>>,
  DefaultView: ComponentType<DefaultViewProps>,
) {
  const { React, store, ui, sdk, icons } = deps
  const { useState } = React
  const { useWorkflows, useCases, useCurrentCase, useWorkflow } = hooks
  const { selectCase, blockProps } = actions

  function Center() {
    const cas = useCurrentCase()
    const wf = useWorkflow(cas)
    const workflows = useWorkflows()
    const activeNodeId = useCrm(s => s.activeNodeId)
    const [adding, setAdding] = useState(false)

    if (!cas) return (
      <DefaultView title="Sprawy" subtitle="Wybierz sprawę z listy lub utwórz nową" subtitleBelow
        top={adding && workflows.map(wf => {
          const stages = wf.stages.filter(s => !s.id.startsWith('dec')).length
          return <ui.FileAction key={wf.id} icon={icons.Briefcase} title={wf.name} subtitle={`${stages} etapów`}
            onClick={async () => {
              const first = wf.stages[0]?.id || ''
              const r = await store.add('case', { workflowType: wf.id, currentStage: first, status: 'nowa' })
              await store.add('event', { kind: 'etap', text: `→ ${wf.name}`, date: new Date().toISOString().slice(0, 10) }, { parentId: r.id })
              sdk.log(`Nowa sprawa: ${wf.name}`, 'ok'); setAdding(false); selectCase(r.id)
            }} />
        })}
        bottom={
          <ui.Button size="lg" color="primary" block onClick={() => setAdding(!adding)}>{adding ? 'Anuluj' : '+ Nowa sprawa'}</ui.Button>
        }
      />
    )

    const node = wf.nodes.find(n => n.id === activeNodeId)
    if (!node) return <ui.Page><ui.Stage><ui.Placeholder text="Wybierz etap na grafie" /></ui.Stage></ui.Page>

    const View = getStageView(node)
    return <View {...blockProps(node, cas, wf)} />
  }

  function RightPanel() {
    const cas = useCurrentCase()
    const wf = useWorkflow(cas)
    const activeNodeId = useCrm(s => s.activeNodeId)
    if (!cas) return null
    const n = wf.nodes.find(n => n.id === activeNodeId)
    const vp = n ? { x: 150 - n.position.x - 120, y: 150 - n.position.y - 40, zoom: 1 } : { x: 0, y: 0, zoom: 1 }
    return <ui.Box header={<ui.Cell label>{wf.name}</ui.Cell>} body={
      <div style={{ height: 300, filter: 'saturate(0.3)' }}>
        <ReactFlow key={cas.id + wf.id + activeNodeId} nodes={wf.nodes} edges={wf.edges} nodeTypes={graphNodeTypes}
          defaultViewport={vp} nodesDraggable={false} nodesConnectable={false}
          panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
          preventScrolling={false} proOptions={{ hideAttribution: true }} />
      </div>
    } />
  }

  function Left() {
    const cases = useCases()
    const allEvents = store.usePosts('event') as PostRecord[]
    const workflows = useWorkflows()
    const caseId = useCrm(s => s.caseId)
    const [search, setSearch] = useState('')
    const [tab, setTab] = useState<'sprawy' | 'terminy'>('sprawy')

    const filtered = search ? cases.filter((c: PostRecord) => {
      const s = search.toLowerCase()
      return (c.data.subject || '').toLowerCase().includes(s) || (c.data.opponent || '').toLowerCase().includes(s) || (c.data.clientName || '').toLowerCase().includes(s)
    }) : cases

    const stageLabel = (c: PostRecord) => {
      const stage = workflows.find(w => w.id === c.data.workflowType)?.stages.find(s => s.id === c.data.currentStage)
      return stage?.label || c.data.status || ''
    }

    const deadlines = allEvents
      .filter((e: PostRecord) => e.data.kind === 'termin' && !e.data.done && e.data.date)
      .sort((a, b) => (a.data.date || '').localeCompare(b.data.date || ''))

    return <ui.Box header={
      <ui.Tabs tabs={[{ id: 'sprawy', label: 'Sprawy' }, { id: 'terminy', label: 'Terminy' }]} active={tab} onChange={(id: string) => setTab(id as 'sprawy' | 'terminy')} />
    } body={tab === 'sprawy' ? (
      <ui.Stack>
        <ui.Input value={search} placeholder="Szukaj..." onChange={(e: { target: { value: string } }) => setSearch(e.target.value)} />
        {filtered.map((c: PostRecord) => <ui.ListItem key={c.id}
          label={c.data.subject || '(bez tytułu)'}
          detail={`${c.data.opponent || ''} · ${stageLabel(c)}`}
          active={c.id === caseId}
          onClick={() => selectCase(c.id)}
          action={<ui.RemoveButton onClick={() => { store.remove(c.id); if (caseId === c.id) selectCase(null) }} />}
        />)}
        {filtered.length === 0 && <ui.Text muted size="2xs">Brak spraw</ui.Text>}
      </ui.Stack>
    ) : (
      <ui.Stack>
        {deadlines.length === 0 && <ui.Text muted size="2xs">Brak terminów</ui.Text>}
        {deadlines.map((ev: PostRecord) => {
          const cas = cases.find((c: PostRecord) => c.id === allEvents.find((e: PostRecord) => e.id === ev.id)?.parentId)
          return <ui.ListItem key={ev.id}
            label={ev.data.text}
            detail={`${ev.data.date}${cas ? ` · ${cas.data.subject}` : ''}`}
            onClick={() => { if (cas) selectCase(cas.id) }}
            action={ev.data.kind === 'termin' && !ev.data.done
              ? <ui.Button size="xs" color="success" onClick={() => store.update(ev.id, { done: true })}>✓</ui.Button>
              : undefined}
          />
        })}
      </ui.Stack>
    )} />
  }

  function Footer() {
    const cas = useCurrentCase()
    const wf = useWorkflow(cas)
    const stage = wf.stages.find(s => s.id === cas?.data?.currentStage)
    return <ui.Row justify="between">
      <ui.Text muted size="xs">{cas ? `${wf.name} → ${stage?.label || '?'}` : 'Brak wybranej sprawy'}</ui.Text>
      <ui.Text muted size="2xs">{useCases().length} spraw</ui.Text>
    </ui.Row>
  }

  return { Left, Center, RightPanel, Footer }
}
