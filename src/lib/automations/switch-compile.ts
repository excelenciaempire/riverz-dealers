/**
 * Pure, React-free compile/decompile for the multi-case "Bifurcar según…"
 * builder node. Lives outside the "use client" builder so it's unit-testable
 * in the node-env vitest runner.
 *
 * A switch over a single data point D with ordered cases
 *   [(op0,v0)→path0, (op1,v1)→path1, …] + else→pathZ
 * compiles to the SAME nested binary `condition` spine the engine already runs
 * (see executeStepsFrom / the live "Nuevo pedido" 3-path):
 *
 *   condition(D op0 v0){ yes: path0, no:[ condition(D op1 v1){ yes: path1,
 *     no:[ … no: pathZ ] } ] }
 *
 * So NOTHING in the engine, steps-tree persistence, DB schema, validate, or
 * @/types changes — `switch` is a builder-only step_type that never reaches the
 * wire. We tag each compiled condition with two marker keys the engine + the
 * validator ignore (they only read subject/operand/op/value/value2) so a
 * save→load round-trip is lossless; a structural fallback collapses
 * marker-less legacy chains (e.g. a hand-built same-data-point cascade).
 */

export type IdFactory = () => string

/** Marker keys authored on every compiled switch condition. */
export const SWITCH_MARKER = '__switch'
export const SWITCH_DP_MARKER = '__dp'

/** A case's condition config: { subject, operand, op, value, value2 }. */
export type CaseCfg = Record<string, unknown>

export interface SwitchCase<S> {
  /** Stable client id — React key + path addressing; survives reorder/delete. */
  ckey: string
  cfg: CaseCfg
  steps: S[]
}

export interface SwitchData<S> {
  /** Chosen data point id (e.g. "offer_units"). */
  dpId?: string
  cases: SwitchCase<S>[]
  /** The "en otro caso" path. */
  elseSteps: S[]
}

/** Minimal shape of a step the decompiler walks — no node id needed. */
export interface StepShape {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes: StepShape[]; no: StepShape[] }
}

export interface ApiStepShape {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStepShape[]; no?: ApiStepShape[] }
}

/** Keep only the engine-relevant condition fields (drops the markers). */
export function pickCaseCfg(cfg: Record<string, unknown>): CaseCfg {
  return {
    subject: cfg.subject,
    operand: cfg.operand,
    op: cfg.op,
    value: cfg.value,
    value2: cfg.value2,
  }
}

/**
 * Lower one switch node to the nested binary-condition spine. `toApi` is the
 * builder's `toApiSteps`, injected so this stays React-free. Returns null when
 * there are zero cases (the caller then splices `elseSteps` inline).
 */
export function compileSwitch<S>(
  data: SwitchData<S> | undefined,
  toApi: (steps: S[]) => ApiStepShape[],
): ApiStepShape | null {
  if (!data) return null
  const cases = data.cases ?? []
  if (cases.length === 0) return null
  let no: ApiStepShape[] = toApi(data.elseSteps ?? [])
  for (let i = cases.length - 1; i >= 0; i--) {
    const c = cases[i]
    const node: ApiStepShape = {
      step_type: 'condition',
      step_config: {
        ...c.cfg,
        [SWITCH_MARKER]: true,
        [SWITCH_DP_MARKER]: data.dpId,
      },
      branches: { yes: toApi(c.steps), no },
    }
    no = [node]
  }
  return no[0]
}

/** Canonical "(subject|operand)" key — every link must test the SAME data point. */
function dpKey(cfg: Record<string, unknown>): string {
  return `${cfg.subject ?? ''}|${cfg.operand ?? ''}`
}

function isSwitchLink(node: StepShape, rootKey: string): boolean {
  return node.step_type === 'condition' && dpKey(node.step_config) === rootKey
}

/**
 * Collapse a switch-shaped nested-condition chain rooted at `head` back into one
 * SwitchData, or return null when it isn't a switch. A chain qualifies only
 * when: head is a condition; the head is marked OR its subject is
 * context_var/contact_field (the kinds the multi-case UI supports); every link
 * shares the head's exact (subject, operand); the spine continues only while a
 * condition's `no` is exactly ONE same-data-point condition; and ≥ 2 cases
 * accrue (a lone binary condition is NEVER turned into a switch).
 */
export function collapseSwitch<S>(
  head: StepShape,
  fromServer: (nodes: StepShape[]) => S[],
  makeId: IdFactory,
  pick: (cfg: Record<string, unknown>) => CaseCfg = pickCaseCfg,
): SwitchData<S> | null {
  if (head.step_type !== 'condition') return null
  const rootKey = dpKey(head.step_config)
  const headMarked = head.step_config[SWITCH_MARKER] === true
  const subject = String(head.step_config.subject ?? '')
  const structuralOk = subject === 'context_var' || subject === 'contact_field'
  if (!headMarked && !structuralOk) return null

  const cases: SwitchCase<S>[] = []
  let cur: StepShape | null = head
  let dpId: string | undefined
  let elseNodes: StepShape[] = []

  while (cur && isSwitchLink(cur, rootKey)) {
    if (dpId === undefined) {
      const m = cur.step_config[SWITCH_DP_MARKER]
      if (typeof m === 'string') dpId = m
    }
    cases.push({
      ckey: makeId(),
      cfg: pick(cur.step_config),
      steps: fromServer(cur.branches?.yes ?? []),
    })
    const no: StepShape[] = cur.branches?.no ?? []
    if (no.length === 1 && isSwitchLink(no[0], rootKey)) {
      cur = no[0]
      continue
    }
    elseNodes = no
    cur = null
  }

  if (cases.length < 2) return null
  return { dpId, cases, elseSteps: fromServer(elseNodes) }
}
