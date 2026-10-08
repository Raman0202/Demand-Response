import { ASSETS } from '../src/data/karnataka'
import { BASELINE_SCENARIO, buildSnapshot } from '../src/engine/grid'
import { PRESETS } from '../src/engine/scenarios'
import { assess, flexibility, options, optimizeWithTwin } from '../src/engine/decision'
for (const p of PRESETS) {
  const s = buildSnapshot({ ...BASELINE_SCENARIO, ...p.params })
  const a = assess(s)
  const ev = flexibility(a, ASSETS)
  const opts = options(a, ev)
  const its = optimizeWithTwin(a, ev)
  const fin = its.at(-1)!
  const best = [...opts].sort((x, y) => x.plan.costs.totalRs - y.plan.costs.totalRs)[0]
  console.log(`${p.id.padEnd(14)} ${a.severity.padEnd(9)} ${a.direction} dev=${a.deviationMW.toFixed(0)} ace=${a.ace.ace.toFixed(0)} req=${a.requirementMW.toFixed(0)} | best=${best.id} ${(best.plan.costs.totalRs/1e5).toFixed(1)}L vs none ${(opts[0].plan.costs.totalRs/1e5).toFixed(1)}L | passes=${its.length} ok=${fin.twin.ok} cov=${fin.plan.coveragePct.toFixed(0)}% bind=${fin.plan.bindings.length} maxLoad=${(fin.plan.maxLoadingAfter.value*100).toFixed(0)}% ${fin.twin.checks.filter(c=>c.status!=='pass').map(c=>c.id+':'+c.status).join(',')}`)
}
