import rfCSS from '@xyflow/react/dist/style.css?inline'
import type { PluginFactory } from '../../plugin-types'
import { extractWorkflowSchema, buildWorkflow } from '../../../packages/workflow-engine/src/engine'
import { createHooks } from './hooks'
import { createActions } from './actions'
import { createStageViews } from './stage-views'
import { createGraphNodes } from './graph-nodes'
import { createPanels } from './panels'

const plugin: PluginFactory = (deps) => {
  const { store, icons, sdk } = deps

  // Register type schemas with validation modes:
  // strict = formularz, musi być kompletny od razu
  // warn   = proces, wypełniany etapami
  // off    = log/zdarzenia, wchodzi co wchodzi
  store.registerType('client', [
    { key: 'name', label: 'Imię i nazwisko', required: true },
    { key: 'phone', label: 'Telefon', inputType: 'tel' },
    { key: 'email', label: 'Email', inputType: 'email' },
  ], 'Klienci', { validation: 'strict' })
  store.registerType('case', [
    { key: 'clientId', label: 'Klient (ID)' },
  ], 'Sprawy', { validation: 'warn' })
  store.registerType('event', [
    { key: 'kind', label: 'Rodzaj', required: true },
    { key: 'text', label: 'Treść' },
    { key: 'date', label: 'Data', inputType: 'date' },
    { key: 'done', label: 'Zakończone' },
  ], 'Zdarzenia', { validation: 'off' })
  store.registerType('workflow', [
    { key: 'wfId', label: 'ID', required: true },
    { key: 'name', label: 'Nazwa', required: true },
  ], 'Procesy', { validation: 'strict' })
  store.registerType('opponent', [
    { key: 'name', label: 'Nazwa', required: true },
    { key: 'opponentType', label: 'Typ' },
    { key: 'legalName', label: 'Nazwa prawna' },
    { key: 'krs', label: 'KRS' },
    { key: 'nip', label: 'NIP' },
    { key: 'address', label: 'Adres' },
    { key: 'formerNames', label: 'Dawne nazwy' },
  ], 'Banki', { validation: 'strict' })

  // Inject React Flow CSS
  if (!document.getElementById('rf-css')) {
    const el = document.createElement('style')
    el.id = 'rf-css'
    el.textContent = rfCSS
    document.head.appendChild(el)
  }

  // Register workflow-derived fields, then system fields
  store.exportJSON('workflow').then(exp => {
    for (const rec of exp.workflow?.records || []) {
      const wf = buildWorkflow(rec)
      for (const { type, fields } of extractWorkflowSchema(wf.stages)) {
        store.registerType(type, fields)
      }
    }
    store.registerType('case', [
      { key: 'workflowType', label: 'Proces' },
      { key: 'currentStage', label: 'Etap' },
      { key: 'status', label: 'Status' },
    ])
  })

  const useCrm = sdk.create(() => ({ caseId: null as string | null, activeNodeId: null as string | null }))
  const hooks = createHooks(store, useCrm)
  const actions = createActions(deps, hooks, useCrm)
  const { DefaultView } = createStageViews(deps, hooks, actions)
  const graphNodeTypes = createGraphNodes(icons, useCrm, hooks)
  const { Left, Center, RightPanel, Footer } = createPanels(deps, hooks, actions, useCrm, graphNodeTypes, DefaultView)

  // Register contribution points
  sdk.registerView('crm.left', { slot: 'left', component: Left })
  sdk.registerView('crm.center', { slot: 'center', component: Center })
  sdk.registerView('crm.right', { slot: 'right', component: RightPanel })
  sdk.registerView('crm.footer', { slot: 'footer', component: Footer })

  return {
    id: 'workflow-crm', label: 'Kancelaria', description: 'Workflow-driven CRM', version: '0.7.0',
    icon: icons.Briefcase,
  }
}

export default plugin
