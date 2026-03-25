import rfCSS from '@xyflow/react/dist/style.css?inline'
import { ReactFlow } from '@xyflow/react'
import type { PluginFactory, PostRecord } from '@obieg-zero/sdk'
import {
  buildWorkflow, extractWorkflowSchema, getNextStage, getStageView, registerStageView, submitStageData, EMPTY_WF,
  type StageDef, type TaskDef, type WorkflowDef, type StageViewProps, type PipelineConfig,
} from '@obieg-zero/workflow-engine/src/engine'
import { createGraphNodes } from '@obieg-zero/workflow-engine/src/graph'
import { runOcrPipeline, type PipelineSummary } from '@obieg-zero/doc-pipeline/src/pipeline'

const plugin: PluginFactory = (deps) => {
  const { React, store, sdk, ui, icons } = deps
  const { useState, useMemo } = React

  // ── Types ───────────────────────────────────────────────────────

  store.registerType('client', [
    { key: 'name', label: 'Imię i nazwisko', required: true },
    { key: 'phone', label: 'Telefon', inputType: 'tel' },
    { key: 'email', label: 'Email', inputType: 'email' },
  ], 'Klienci', { strict: true })
  store.registerType('case', [{ key: 'clientId', label: 'Klient (ID)' }], 'Sprawy')
  store.registerType('event', [
    { key: 'kind', label: 'Rodzaj', required: true },
    { key: 'text', label: 'Treść' },
    { key: 'date', label: 'Data', inputType: 'date' },
    { key: 'done', label: 'Zakończone' },
  ], 'Zdarzenia')
  store.registerType('workflow', [
    { key: 'wfId', label: 'ID', required: true },
    { key: 'name', label: 'Nazwa', required: true },
  ], 'Procesy', { strict: true })
  store.registerType('opponent', [
    { key: 'name', label: 'Nazwa', required: true },
    { key: 'opponentType', label: 'Typ' },
    { key: 'legalName', label: 'Nazwa prawna' },
    { key: 'krs', label: 'KRS' },
    { key: 'nip', label: 'NIP' },
    { key: 'address', label: 'Adres' },
    { key: 'formerNames', label: 'Dawne nazwy' },
  ], 'Banki', { strict: true })
  store.registerType('opponent-template', [
    { key: 'name', label: 'Nazwa szablonu', required: true },
    { key: 'margin', label: 'Marża (%)', inputType: 'number' },
    { key: 'bridgeMargin', label: 'Pomostowa (%)', inputType: 'number' },
    { key: 'wiborType', label: 'WIBOR' },
    { key: 'commission', label: 'Prowizja (%)', inputType: 'number' },
    { key: 'interestMethod', label: 'Metoda naliczania' },
  ], 'Szablony umów')

  // Workflow-derived schema
  for (const rec of store.getPosts('workflow')) {
    const wf = buildWorkflow(rec)
    for (const { type, fields } of extractWorkflowSchema(wf.stages)) store.registerType(type, fields)
  }
  store.registerType('case', [{ key: 'workflowType', label: 'Proces' }, { key: 'currentStage', label: 'Etap' }, { key: 'status', label: 'Status' }])

  // ── State ───────────────────────────────────────────────────────

  const useCrm = sdk.create(() => ({ caseId: null as string | null, activeNodeId: null as string | null }))

  const selectCase = (id: string | null) => {
    if (id) { const r = store.get(id); useCrm.setState({ caseId: id, activeNodeId: (r?.data?.currentStage as string) || null }) }
    else useCrm.setState({ caseId: null, activeNodeId: null })
    sdk.shared.setState({ crm: { caseId: id } })
  }

  const advanceToStage = (caseId: string, stageId: string, wf: WorkflowDef) => {
    const label = wf.stages.find(s => s.id === stageId)?.label || stageId
    store.update(caseId, { currentStage: stageId })
    store.add('event', { kind: 'etap', text: `→ ${label}`, date: new Date().toISOString().slice(0, 10) }, { parentId: caseId })
    useCrm.setState({ activeNodeId: stageId })
    sdk.log(label, 'ok')
  }

  const useCase = () => store.usePost(useCrm(s => s.caseId))
  const useWf = (cas?: PostRecord) => {
    const wfs = store.usePosts('workflow').map(buildWorkflow)
    return wfs.find(w => w.id === cas?.data?.workflowType) || EMPTY_WF
  }
  const useEvents = (caseId?: string | null) => store.useChildren(caseId, 'event').sort((a, b) => b.createdAt - a.createdAt)

  const blockProps = (node: any, cas: PostRecord, wf: WorkflowDef): StageViewProps => ({
    node, cas, wf, store, sdk, ui, icons, advanceToStage,
    uploadFile: (pid: string) => sdk.uploadFile(pid),
    downloadFile: (ev: PostRecord) => sdk.downloadFile(ev.id, ev.data.text),
    useEvents, getNextStage,
  })

  // ── Upload view (pipeline-specific) ─────────────────────────────

  function UploadView(props: StageViewProps) {
    const { node, cas, wf, uploadFile } = props
    const events = useEvents(cas.id)
    const files = events.filter((e: PostRecord) => e.data.kind === 'plik')
    const nextId = getNextStage(wf, node.id)
    const stage = wf.stages.find((s: StageDef) => s.id === node.id)
    const hasPipeline = !!(stage?.pipeline?.ocr || stage?.pipeline?.embed)
    const [running, setRunning] = useState(false)

    const ocrEvents = useMemo(() => events.filter(e => e.data.kind === 'ocr'), [events])
    const chunkEvents = useMemo(() => events.filter(e => e.data.kind === 'chunks'), [events])
    const pipelineDone = ocrEvents.length > 0

    const extracted = useMemo(() => {
      const qs = stage?.pipeline?.extract?.questions || {}
      return Object.keys(qs).filter(k => cas.data[k]).map(k => ({ field: k, value: String(cas.data[k]) }))
    }, [cas.data, stage])

    const runPipeline = async () => {
      if (!stage?.pipeline) return
      setRunning(true)
      try {
        const apiUrl = store.useOption('openai_api_url') || 'https://api.openai.com/v1/chat/completions'
        const apiKey = store.useOption('openai_api_key') || ''
        const model = store.useOption('openai_model') || 'gpt-4o-mini'
        await runOcrPipeline(store as any, cas.id, files, { ocr: ocrEvents, chunks: chunkEvents }, stage.pipeline, sdk.log, { apiUrl, apiKey, model })
      } catch (e: unknown) { sdk.log(`Pipeline: ${e instanceof Error ? e.message : String(e)}`, 'error') }
      setRunning(false)
    }

    const phase = running ? 'analyzing' : pipelineDone ? 'done' : files.length > 0 && hasPipeline ? 'ready' : 'upload'
    const stepNum = node.data.label.match(/^(\d+)/)?.[1]
    const title = node.data.label.replace(/^\d+\.\s*/, '')
    const checklist = stage?.checklist?.filter((c: TaskDef) => c.type === 'upload') || []

    return (
      <ui.Page><ui.Stage><ui.StageLayout
        top={<ui.Stack gap="md">
          <ui.StepHeading step={stepNum} title={title} subtitle={node.data.description} />
          {phase === 'upload' && checklist.map((c: TaskDef, i: number) => <ui.CheckItem key={i} label={c.text} />)}
          {phase === 'ready' && files.map((ev: PostRecord) => <ui.CheckItem key={ev.id} label={ev.data.text} checked />)}
          {phase === 'done' && extracted.length > 0 && extracted.map(e => <ui.ListItem key={e.field} label={e.field} detail={e.value} />)}
          {phase === 'done' && extracted.length === 0 && <ui.CheckItem label="Dokument przeanalizowany" checked />}
        </ui.Stack>}
        bottom={<ui.Stack gap="md">
          {phase === 'upload' && <><ui.FileAction icon={icons.Upload} title="Wybierz plik" subtitle="PDF, TXT lub skan dokumentu" onClick={() => uploadFile(cas.id)} />
            {nextId && <ui.Button size="lg" color="primary" outline block onClick={() => advanceToStage(cas.id, nextId, wf)}>Pomiń ten krok</ui.Button>}</>}
          {phase === 'ready' && <><ui.Button size="lg" color="ghost" onClick={() => uploadFile(cas.id)}>+ Dodaj kolejny</ui.Button>
            <ui.Button size="lg" color="primary" block onClick={runPipeline}>Analizuj dokumenty</ui.Button></>}
          {phase === 'analyzing' && <ui.Placeholder text="Analizuję dokumenty..."><ui.Spinner /></ui.Placeholder>}
          {phase === 'done' && nextId && <ui.Button size="lg" color="primary" block onClick={() => advanceToStage(cas.id, nextId, wf)}>Dalej</ui.Button>}
        </ui.Stack>}
      /></ui.Stage></ui.Page>
    )
  }
  registerStageView('upload', UploadView)

  // ── Inject CSS ──────────────────────────────────────────────────

  if (!document.getElementById('rf-css')) { const el = document.createElement('style'); el.id = 'rf-css'; el.textContent = rfCSS; document.head.appendChild(el) }

  // ── Graph nodes ─────────────────────────────────────────────────

  const graphNodeTypes = createGraphNodes(
    icons,
    (id) => id === useCrm(s => s.activeNodeId),
    (id) => useCase()?.data?.currentStage === id,
    (id) => useCrm.setState({ activeNodeId: id }),
  )

  // ── Views ───────────────────────────────────────────────────────

  function Left() {
    const cases = store.usePosts('case')
    const workflows = store.usePosts('workflow').map(buildWorkflow)
    const caseId = useCrm(s => s.caseId)
    const [search, setSearch] = useState('')
    const [tab, setTab] = useState<'sprawy' | 'terminy'>('sprawy')

    const filtered = search ? cases.filter((c: PostRecord) => {
      const s = search.toLowerCase()
      return (c.data.subject || '').toLowerCase().includes(s) || (c.data.opponent || '').toLowerCase().includes(s)
    }) : cases

    const stageLabel = (c: PostRecord) => workflows.find(w => w.id === c.data.workflowType)?.stages.find(s => s.id === c.data.currentStage)?.label || c.data.status || ''

    const deadlines = store.usePosts('event').filter((e: PostRecord) => e.data.kind === 'termin' && !e.data.done && e.data.date).sort((a, b) => (a.data.date || '').localeCompare(b.data.date || ''))

    return <ui.Box header={<ui.Tabs tabs={[{ id: 'sprawy', label: 'Sprawy' }, { id: 'terminy', label: 'Terminy' }]} active={tab} onChange={(id: string) => setTab(id as any)} />}
      body={tab === 'sprawy' ? <ui.Stack>
        <ui.Input value={search} placeholder="Szukaj..." onChange={(e: any) => setSearch(e.target.value)} />
        {filtered.map((c: PostRecord) => <ui.ListItem key={c.id} label={c.data.subject || '(bez tytułu)'} detail={`${c.data.opponent || ''} · ${stageLabel(c)}`}
          active={c.id === caseId} onClick={() => selectCase(c.id)} action={<ui.RemoveButton onClick={() => { store.remove(c.id); if (caseId === c.id) selectCase(null) }} />} />)}
        {!filtered.length && <ui.Text muted size="2xs">Brak spraw</ui.Text>}
      </ui.Stack> : <ui.Stack>
        {!deadlines.length && <ui.Text muted size="2xs">Brak terminów</ui.Text>}
        {deadlines.map((ev: PostRecord) => {
          const cas = cases.find(c => c.id === ev.parentId)
          return <ui.ListItem key={ev.id} label={ev.data.text} detail={`${ev.data.date}${cas ? ` · ${cas.data.subject}` : ''}`}
            onClick={() => cas && selectCase(cas.id)}
            action={!ev.data.done ? <ui.Button size="xs" color="success" onClick={() => store.update(ev.id, { done: true })}>✓</ui.Button> : undefined} />
        })}
      </ui.Stack>} />
  }

  function Center() {
    const cas = useCase(), wf = useWf(cas)
    const workflows = store.usePosts('workflow').map(buildWorkflow)
    const activeNodeId = useCrm(s => s.activeNodeId)
    const [adding, setAdding] = useState(false)

    if (!cas) return <ui.Page><ui.Stage><ui.StageLayout
      top={<ui.Stack gap="md"><ui.StepHeading title="Sprawy" subtitle="Wybierz sprawę z listy lub utwórz nową" subtitleBelow />
        {adding && workflows.map(wf => <ui.FileAction key={wf.id} icon={icons.Briefcase} title={wf.name} subtitle={`${wf.stages.filter(s => !s.id.startsWith('dec')).length} etapów`}
          onClick={() => { const r = store.add('case', { workflowType: wf.id, currentStage: wf.stages[0]?.id || '', status: 'nowa' }); store.add('event', { kind: 'etap', text: `→ ${wf.name}`, date: new Date().toISOString().slice(0, 10) }, { parentId: r.id }); sdk.log(`Nowa sprawa: ${wf.name}`, 'ok'); setAdding(false); selectCase(r.id) }} />)}
      </ui.Stack>}
      bottom={<ui.Button size="lg" color="primary" block onClick={() => setAdding(!adding)}>{adding ? 'Anuluj' : '+ Nowa sprawa'}</ui.Button>}
    /></ui.Stage></ui.Page>

    const node = wf.nodes.find(n => n.id === activeNodeId)
    if (!node) return <ui.Page><ui.Stage><ui.Placeholder text="Wybierz etap na grafie" /></ui.Stage></ui.Page>
    const View = getStageView(node)
    return <View {...blockProps(node, cas, wf)} />
  }

  function RightPanel() {
    const cas = useCase(), wf = useWf(cas), activeNodeId = useCrm(s => s.activeNodeId)
    if (!cas) return null
    const n = wf.nodes.find(n => n.id === activeNodeId)
    const vp = n ? { x: 150 - n.position.x - 120, y: 150 - n.position.y - 40, zoom: 1 } : { x: 0, y: 0, zoom: 1 }
    return <ui.Box header={<ui.Cell label>{wf.name}</ui.Cell>} body={
      <div style={{ height: 300, filter: 'saturate(0.3)' }}>
        <ReactFlow key={cas.id + wf.id + activeNodeId} nodes={wf.nodes} edges={wf.edges} nodeTypes={graphNodeTypes}
          colorMode={document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'}
          defaultViewport={vp} nodesDraggable={false} nodesConnectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false} proOptions={{ hideAttribution: true }} />
      </div>
    } />
  }

  function Footer() {
    const cas = useCase(), wf = useWf(cas)
    const stage = wf.stages.find(s => s.id === cas?.data?.currentStage)
    return <ui.Row justify="between">
      <ui.Text muted size="xs">{cas ? `${wf.name} → ${stage?.label || '?'}` : 'Brak wybranej sprawy'}</ui.Text>
      <ui.Text muted size="2xs">{store.usePosts('case').length} spraw</ui.Text>
    </ui.Row>
  }

  sdk.registerView('crm.left', { slot: 'left', component: Left })
  sdk.registerView('crm.center', { slot: 'center', component: Center })
  sdk.registerView('crm.right', { slot: 'right', component: RightPanel })
  sdk.registerView('crm.footer', { slot: 'footer', component: Footer })

  return { id: 'workflow-crm', label: 'Kancelaria', description: 'Workflow-driven CRM', version: '0.8.0', icon: icons.Briefcase }
}

export default plugin
