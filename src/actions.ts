import type { PluginDeps, PostRecord } from '../../plugin-types'
import type { GraphNode, WorkflowDef, StageViewProps } from '../../../packages/workflow-engine/src/engine'
import { getNextStage } from '../../../packages/workflow-engine/src/engine'
import type { CrmStore, Hooks } from './hooks'

export function createActions(deps: PluginDeps, hooks: Hooks, useCrm: CrmStore) {
  const { store, sdk, ui, icons } = deps

  const selectCase = (id: string | null) => {
    if (id) store.get(id).then(r => useCrm.setState({ caseId: id, activeNodeId: (r?.data?.currentStage as string) || null }))
    else useCrm.setState({ caseId: null, activeNodeId: null })
  }

  const advanceToStage = async (caseId: string, stageId: string, wf: WorkflowDef) => {
    const label = wf.stages.find(s => s.id === stageId)?.label || stageId
    await store.update(caseId, { currentStage: stageId })
    await store.add('event', { kind: 'etap', text: `→ ${label}`, date: new Date().toISOString().slice(0, 10) }, { parentId: caseId })
    useCrm.setState({ activeNodeId: stageId })
    sdk.log(label, 'ok')
  }

  const uploadFile = async (parentId: string) => {
    const file = await sdk.openFileDialog('*')
    if (!file) return
    const ev = await store.add('event', { kind: 'plik', text: file.name, date: new Date().toISOString().slice(0, 10) }, { parentId })
    await store.writeFile(ev.id, file.name, file)
    sdk.log(`Dodano: ${file.name}`, 'ok')
  }

  const downloadFile = async (ev: PostRecord) => {
    const f = await store.readFile(ev.id, ev.data.text)
    const u = URL.createObjectURL(f)
    Object.assign(document.createElement('a'), { href: u, download: ev.data.text }).click()
    URL.revokeObjectURL(u)
  }

  const blockProps = (node: GraphNode, cas: PostRecord, wf: WorkflowDef): StageViewProps => ({
    node, cas, wf, store, sdk, ui, icons, advanceToStage, uploadFile, downloadFile, useEvents: hooks.useEvents, getNextStage,
  })

  return { selectCase, advanceToStage, uploadFile, downloadFile, blockProps }
}

export type Actions = ReturnType<typeof createActions>
