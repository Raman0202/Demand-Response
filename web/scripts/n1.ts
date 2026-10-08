import { solveDCPF, lineLabel } from '../src/engine/network'
import { buildSnapshot, busInjections, BASELINE_SCENARIO } from '../src/engine/grid'
import { LINES } from '../src/data/karnataka'
const s = buildSnapshot({ ...BASELINE_SCENARIO, demandShockMW: 300 })
for (const o of LINES) {
  const r = solveDCPF(busInjections(s), [o.id])
  const over = Object.entries(r.loading).filter(([,v]) => v > 0.98).map(([k,v]) => `${lineLabel(k)} ${(v*100).toFixed(0)}%`)
  console.log(o.id, lineLabel(o.id).padEnd(36), over.join(' | '))
}
