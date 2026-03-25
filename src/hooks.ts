import type { Store, PostRecord } from '../../plugin-types'
import { buildWorkflow, EMPTY_WF } from '../../../packages/workflow-engine/src/engine'

export interface CrmState { caseId: string | null; activeNodeId: string | null }
export type CrmStore = { (): CrmState; <U>(selector: (s: CrmState) => U): U; setState(partial: Partial<CrmState>): void; getState(): CrmState }

export function createHooks(store: Store, useCrm: CrmStore) {

  const useWorkflows = () =>
    (store.usePosts('workflow') as PostRecord[]).map(buildWorkflow)

  const useCases = () =>
    store.usePosts('case') as PostRecord[]

  const useEvents = (caseId?: string | null) => {
    const all = store.usePosts('event') as PostRecord[]
    return caseId
      ? all.filter((e: PostRecord) => e.parentId === caseId).sort((a, b) => b.createdAt - a.createdAt)
      : []
  }

  const useCurrentCase = () => {
    const id = useCrm(s => s.caseId)
    const cases = useCases()
    return cases.find(c => c.id === id)
  }

  const useWorkflow = (cas?: PostRecord) => {
    const wfs = useWorkflows()
    return wfs.find(w => w.id === cas?.data?.workflowType) || EMPTY_WF
  }

  return { useWorkflows, useCases, useEvents, useCurrentCase, useWorkflow }
}

export type Hooks = ReturnType<typeof createHooks>
