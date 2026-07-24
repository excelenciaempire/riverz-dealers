import { describe, expect, it } from 'vitest'
import {
  compileSwitch,
  collapseSwitch,
  pickCaseCfg,
  SWITCH_MARKER,
  SWITCH_DP_MARKER,
  type ApiStepShape,
  type StepShape,
  type SwitchData,
} from './switch-compile'

// A builder-like node for the tests (mirrors BuilderStep without React).
type N = {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes: N[]; no: N[] }
  switchData?: SwitchData<N>
}

let counter = 0
const id = () => `k${counter++}`

/** Mirror of the builder's toApiSteps (switch → nested binary spine). */
function toApi(steps: N[]): ApiStepShape[] {
  const out: ApiStepShape[] = []
  for (const s of steps) {
    if (s.step_type === 'switch') {
      const compiled = compileSwitch(s.switchData, toApi)
      if (compiled) out.push(compiled)
      else out.push(...toApi(s.switchData?.elseSteps ?? []))
      continue
    }
    out.push({
      step_type: s.step_type,
      step_config: s.step_config,
      branches: s.branches
        ? { yes: toApi(s.branches.yes), no: toApi(s.branches.no) }
        : undefined,
    })
  }
  return out
}

/** Mirror of the builder's fromServerSteps (collapse switch-shaped chains). */
function fromServer(nodes: StepShape[]): N[] {
  return nodes.map((n) => {
    if (n.step_type === 'condition') {
      const sd = collapseSwitch<N>(n, fromServer, id)
      if (sd) return { step_type: 'switch', step_config: { dpId: sd.dpId }, switchData: sd }
    }
    return {
      step_type: n.step_type,
      step_config: n.step_config,
      branches:
        n.step_type === 'condition'
          ? { yes: fromServer(n.branches?.yes ?? []), no: fromServer(n.branches?.no ?? []) }
          : undefined,
    }
  })
}

/** Compiled ApiStepShape → server-node shape (branches always present). */
function asServer(a: ApiStepShape): StepShape {
  return {
    step_type: a.step_type,
    step_config: a.step_config,
    branches: {
      yes: (a.branches?.yes ?? []).map(asServer),
      no: (a.branches?.no ?? []).map(asServer),
    },
  }
}

const leaf = (tag: string): N => ({ step_type: 'send_template', step_config: { _m: tag } })
const cond = (cfg: Record<string, unknown>, yes: StepShape[], no: StepShape[]): StepShape => ({
  step_type: 'condition',
  step_config: cfg,
  branches: { yes, no },
})
const sleaf = (tag: string): StepShape => ({ step_type: 'send_template', step_config: { _m: tag }, branches: { yes: [], no: [] } })

describe('compileSwitch', () => {
  it('folds cases into a nested binary spine, else innermost', () => {
    const sw: SwitchData<N> = {
      dpId: 'offer_units',
      cases: [
        { ckey: 'a', cfg: { subject: 'context_var', operand: 'offer_units', op: 'gte', value: '4' }, steps: [leaf('A')] },
        { ckey: 'b', cfg: { subject: 'context_var', operand: 'offer_units', op: 'gte', value: '2' }, steps: [leaf('B')] },
      ],
      elseSteps: [leaf('Z')],
    }
    const api = compileSwitch(sw, toApi)!
    expect(api.step_type).toBe('condition')
    expect(api.step_config[SWITCH_MARKER]).toBe(true)
    expect(api.step_config[SWITCH_DP_MARKER]).toBe('offer_units')
    expect(api.step_config.value).toBe('4')
    expect(api.branches!.yes![0].step_config._m).toBe('A')
    const inner = api.branches!.no![0]
    expect(inner.step_config.value).toBe('2')
    expect(inner.branches!.yes![0].step_config._m).toBe('B')
    expect(inner.branches!.no![0].step_config._m).toBe('Z')
  })

  it('returns null for zero cases', () => {
    expect(compileSwitch({ dpId: 'x', cases: [], elseSteps: [] }, toApi)).toBeNull()
    expect(compileSwitch(undefined, toApi)).toBeNull()
  })
})

describe('collapseSwitch round-trip', () => {
  it('compile → collapse is an exact inverse (markers)', () => {
    const sw: SwitchData<N> = {
      dpId: 'offer_units',
      cases: [
        { ckey: 'a', cfg: { subject: 'context_var', operand: 'offer_units', op: 'eq', value: '1' }, steps: [leaf('A')] },
        { ckey: 'b', cfg: { subject: 'context_var', operand: 'offer_units', op: 'eq', value: '3' }, steps: [leaf('B')] },
        { ckey: 'c', cfg: { subject: 'context_var', operand: 'offer_units', op: 'eq', value: '4' }, steps: [leaf('C')] },
      ],
      elseSteps: [leaf('Z')],
    }
    const api = compileSwitch(sw, toApi)!
    const sd = collapseSwitch<N>(asServer(api), fromServer, id)!
    expect(sd.dpId).toBe('offer_units')
    expect(sd.cases.map((c) => c.cfg.value)).toEqual(['1', '3', '4'])
    expect(sd.cases.map((c) => (c.steps[0] as N).step_config._m)).toEqual(['A', 'B', 'C'])
    expect((sd.elseSteps[0] as N).step_config._m).toBe('Z')
    // idempotent: recompiling produces the same structure
    expect(compileSwitch(sd, toApi)).toEqual(api)
  })

  it('preserves op=between + value2', () => {
    const sw: SwitchData<N> = {
      dpId: 'offer_units',
      cases: [
        { ckey: 'a', cfg: { subject: 'context_var', operand: 'offer_units', op: 'between', value: '2', value2: '3' }, steps: [leaf('A')] },
        { ckey: 'b', cfg: { subject: 'context_var', operand: 'offer_units', op: 'gte', value: '4' }, steps: [leaf('B')] },
      ],
      elseSteps: [],
    }
    const sd = collapseSwitch<N>(asServer(compileSwitch(sw, toApi)!), fromServer, id)!
    expect(sd.cases[0].cfg).toMatchObject({ op: 'between', value: '2', value2: '3' })
  })
})

describe('collapseSwitch structural walk', () => {
  it('collapses a marker-LESS legacy same-data-point cascade', () => {
    // The live "Nuevo pedido": 3 context_var/offer_units conditions, single-no
    // spine, terminal else — NO __switch markers.
    const chain = cond(
      { subject: 'context_var', operand: 'offer_units', value: '1' },
      [sleaf('A')],
      [
        cond(
          { subject: 'context_var', operand: 'offer_units', value: '3' },
          [sleaf('B')],
          [
            cond(
              { subject: 'context_var', operand: 'offer_units', value: '4' },
              [sleaf('C')],
              [sleaf('Z')],
            ),
          ],
        ),
      ],
    )
    const sd = collapseSwitch<N>(chain, fromServer, id)!
    expect(sd.cases.map((c) => c.cfg.value)).toEqual(['1', '3', '4'])
    expect((sd.elseSteps[0] as N).step_config._m).toBe('Z')
  })

  it('folds a lone binary condition into one case + else', () => {
    const lone = cond({ subject: 'context_var', operand: 'offer_units', value: '1' }, [sleaf('A')], [sleaf('Z')])
    const sd = collapseSwitch<N>(lone, fromServer, id)!
    expect(sd.cases).toHaveLength(1)
    expect(sd.cases[0].cfg.value).toBe('1')
    expect((sd.elseSteps[0] as N).step_config._m).toBe('Z')
  })

  it('merges conditions over DIFFERENT data points into ordered cases', () => {
    const chain = cond(
      { subject: 'context_var', operand: 'offer_units', value: '1' },
      [sleaf('A')],
      [cond({ subject: 'context_var', operand: 'total_price', value: '100' }, [sleaf('B')], [sleaf('Z')])],
    )
    const sd = collapseSwitch<N>(chain, fromServer, id)!
    expect(sd.cases.map((c) => c.cfg.operand)).toEqual(['offer_units', 'total_price'])
    expect((sd.elseSteps[0] as N).step_config._m).toBe('Z')
  })

  it('stops the spine when a .no lane has 2+ steps (they become the else)', () => {
    const chain = cond(
      { subject: 'context_var', operand: 'offer_units', value: '1' },
      [sleaf('A')],
      [sleaf('X'), cond({ subject: 'context_var', operand: 'offer_units', value: '3' }, [sleaf('B')], [sleaf('Z')])],
    )
    // A .no with a leading action isn't an `else if`, so the spine ends: one
    // case, and the whole 2-step lane is the else. The builder's allLeaf guard
    // then keeps this as a plain nested condition rather than one flat card.
    const sd = collapseSwitch<N>(chain, fromServer, id)!
    expect(sd.cases).toHaveLength(1)
    expect(sd.elseSteps).toHaveLength(2)
  })

  it('collapses any subject, not just numeric data points (tag cascade)', () => {
    const tagChain = cond(
      { subject: 'tag_presence', operand: 't1' },
      [sleaf('A')],
      [cond({ subject: 'tag_presence', operand: 't2' }, [sleaf('B')], [sleaf('Z')])],
    )
    const sd = collapseSwitch<N>(tagChain, fromServer, id)!
    expect(sd.cases.map((c) => c.cfg.operand)).toEqual(['t1', 't2'])
  })

  it('returns null only for a non-condition head', () => {
    expect(collapseSwitch<N>(sleaf('A'), fromServer, id)).toBeNull()
  })
})

describe('pickCaseCfg', () => {
  it('keeps only engine fields (drops markers)', () => {
    expect(
      pickCaseCfg({ subject: 'context_var', operand: 'offer_units', op: 'gte', value: '4', value2: undefined, [SWITCH_MARKER]: true, [SWITCH_DP_MARKER]: 'offer_units' }),
    ).toEqual({ subject: 'context_var', operand: 'offer_units', op: 'gte', value: '4', value2: undefined })
  })
})
