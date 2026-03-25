import type { PluginDeps, PostRecord, SchemaField } from '../../plugin-types'
import { runOcrPipeline, type PipelineSummary } from '../../../packages/doc-pipeline/src/pipeline'
import {
  getNextStage, SelectField, registerStageView, submitStageData,
  type StageDef, type TaskDef, type StageViewProps,
} from '../../../packages/workflow-engine/src/engine'
import type { Hooks } from './hooks'
import type { Actions } from './actions'

export function createStageViews(deps: PluginDeps, hooks: Hooks, actions: Actions) {
  const { React, store, sdk, ui, icons } = deps
  const { useState, useMemo } = React
  const { useEvents } = hooks
  const { advanceToStage, uploadFile, downloadFile } = actions

  function FormView(props: StageViewProps) {
    const { node, cas, wf } = props
    const stepNum = node.data.label.match(/^(\d+)/)?.[1]
    const title = node.data.label.replace(/^\d+\.\s*/, '')
    const stage = wf.stages.find((s: StageDef) => s.id === node.id)!
    const recordType = stage.recordType || 'case'
    const isLinked = recordType !== 'case'
    const linkedId = cas.data[`${recordType}Id`] as string | undefined
    const linkedRecords = store.usePosts(recordType) as PostRecord[]
    const linkedRecord = isLinked && linkedId ? linkedRecords.find(r => r.id === linkedId) : undefined
    const schema: SchemaField[] = node.data.fields || store.getType(recordType)?.schema || []
    const formDefaults = isLinked ? (linkedRecord?.data || {}) : (cas.data || {})
    const isComplete = (data: Record<string, unknown>) => schema.filter(f => f.required).every(f => !!data[f.key])
    const { bind, incomplete, showForm, submit, toggle } = sdk.useForm(formDefaults, {
      onSubmit: async (data: Record<string, unknown>) => {
        await submitStageData(store, cas, stage, data)
        sdk.log('Zapisano', 'ok')
      },
      isComplete, sync: isLinked ? linkedRecord?.data : cas.data,
    })
    const nextId = getNextStage(wf, node.id)

    return (
      <ui.Page><ui.Stage><ui.StageLayout
        top={<ui.Stack gap="md">
          <ui.StepHeading step={stepNum} title={title} subtitle={node.data.description} />
          {schema.map((f: SchemaField) => f.inputType?.startsWith('select:')
            ? <SelectField key={f.key} field={f} bind={bind} store={store} ui={ui} />
            : <ui.Field key={f.key} label={f.label} required={f.required}><ui.Input {...bind(f.key)} type={f.inputType} /></ui.Field>
          )}
        </ui.Stack>}
        bottom={<ui.Stack>
          {nextId && <ui.Button size="lg" color="primary" block disabled={incomplete} onClick={async () => { await submit(); advanceToStage(cas.id, nextId, wf) }}>Dalej</ui.Button>}
          {!nextId && <ui.Button size="lg" color="primary" block disabled={incomplete} onClick={submit}>Zapisz</ui.Button>}
        </ui.Stack>}
      /></ui.Stage></ui.Page>
    )
  }

  function usePipelineSummary(events: PostRecord[], cas: PostRecord, stage?: StageDef) {
    const ocrEvents = useMemo(() => events.filter(e => e.data.kind === 'ocr'), [events])
    const chunkEvents = useMemo(() => events.filter(e => e.data.kind === 'chunks'), [events])

    const summary = useMemo<PipelineSummary | null>(() => {
      if (ocrEvents.length === 0) return null
      const classified = ocrEvents
        .filter(e => e.data.docGroup)
        .map(e => ({ file: e.data.sourceFile, label: e.data.docGroup, score: 1 }))
      const embedGroups = chunkEvents.map(e => ({
        group: e.data.group,
        chunks: (e.data.chunks || []).length,
      }))
      const extractQuestions = stage?.pipeline?.extract?.questions || {}
      const extracted: PipelineSummary['extracted'] = []
      for (const field of Object.keys(extractQuestions)) {
        const val = cas.data[field]
        if (val) extracted.push({ field, label: field, value: String(val) })
      }
      return {
        filesProcessed: ocrEvents.length,
        totalPages: ocrEvents.reduce((s: number, e: PostRecord) => s + (e.data.pages?.length || 0), 0),
        totalChars: ocrEvents.reduce((s: number, e: PostRecord) => s + ((e.data.pages as { text?: string }[]) || []).reduce((cs: number, p: { text?: string }) => cs + (p.text?.length || 0), 0), 0),
        classified,
        embedGroups,
        extracted,
      }
    }, [ocrEvents, chunkEvents, cas.data, stage])

    return { summary, ocrEvents, chunkEvents }
  }

  function UploadView(props: StageViewProps) {
    const { node, cas, wf } = props
    const events = useEvents(cas.id)
    const files = events.filter((e: PostRecord) => e.data.kind === 'plik')
    const nextId = getNextStage(wf, node.id)
    const stage = wf.stages.find((s: StageDef) => s.id === node.id)
    const hasPipeline = !!(stage?.pipeline?.ocr || stage?.pipeline?.embed)
    const [running, setRunning] = useState(false)
    const { summary, ocrEvents, chunkEvents } = usePipelineSummary(events, cas, stage)
    const pipelineDone = summary !== null

    const apiUrl = store.useOption('openai_api_url') || 'https://api.openai.com/v1/chat/completions'
    const apiKey = store.useOption('openai_api_key') || ''
    const model = store.useOption('openai_model') || 'gpt-4o-mini'

    const runPipeline = async () => {
      if (!stage?.pipeline) return
      setRunning(true)
      try {
        await runOcrPipeline(store, cas.id, files, { ocr: ocrEvents, chunks: chunkEvents }, stage.pipeline, sdk.log, { apiUrl, apiKey, model })
      } catch (e: unknown) {
        sdk.log(`Pipeline: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
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
          {phase === 'upload' && checklist.length > 0 && (<ui.Stack>
            {checklist.map((c: TaskDef, i: number) => <ui.CheckItem key={i} label={c.text} />)}
          </ui.Stack>)}
          {phase === 'ready' && (<ui.Stack>
            {files.map((ev: PostRecord) => <ui.CheckItem key={ev.id} label={ev.data.text} checked />)}
          </ui.Stack>)}
          {phase === 'done' && summary && summary.extracted.length > 0 && (<ui.Stack>
            {summary.extracted.map(e => <ui.ListItem key={e.field} label={e.field} detail={e.value} />)}
          </ui.Stack>)}
          {phase === 'done' && (!summary || summary.extracted.length === 0) && (
            <ui.CheckItem label="Dokument przeanalizowany" checked />
          )}
        </ui.Stack>}
        bottom={<ui.Stack gap="md">
          {phase === 'upload' && (<ui.Stack>
            <ui.FileAction icon={icons.Upload} title="Wybierz plik" subtitle="PDF, TXT lub skan dokumentu" onClick={() => uploadFile(cas.id)} />
            {nextId && <ui.Button size="lg" color="primary" outline block onClick={() => advanceToStage(cas.id, nextId, wf)}>Pomiń ten krok</ui.Button>}
          </ui.Stack>)}
          {phase === 'ready' && (<ui.Stack>
            <ui.Button size="lg" color="ghost" onClick={() => uploadFile(cas.id)}>+ Dodaj kolejny</ui.Button>
            <ui.Button size="lg" color="primary" block onClick={runPipeline}>Analizuj dokumenty</ui.Button>
          </ui.Stack>)}
          {phase === 'analyzing' && (
            <ui.Placeholder text="Analizuję dokumenty..."><ui.Spinner /></ui.Placeholder>
          )}
          {phase === 'done' && nextId && (
            <ui.Button size="lg" color="primary" block onClick={() => advanceToStage(cas.id, nextId, wf)}>Dalej</ui.Button>
          )}
        </ui.Stack>}
      /></ui.Stage></ui.Page>
    )
  }

  function DefaultView({ title, subtitle, subtitleBelow, top, bottom }: {
    title: string; subtitle?: string; subtitleBelow?: boolean; top?: React.ReactNode; bottom?: React.ReactNode
  }) {
    return (
      <ui.Page><ui.Stage><ui.StageLayout
        top={<ui.Stack gap="md">
          <ui.StepHeading title={title} subtitle={subtitle} subtitleBelow={subtitleBelow} />
          {top}
        </ui.Stack>}
        bottom={bottom}
      /></ui.Stage></ui.Page>
    )
  }

  registerStageView('form', FormView)
  registerStageView('upload', UploadView)

  return { DefaultView }
}
