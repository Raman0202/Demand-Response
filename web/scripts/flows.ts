import { solveDCPF, lineLabel } from '../src/engine/network'
import { buildSnapshot, busInjections, BASELINE_SCENARIO } from '../src/engine/grid'
import { LINES } from '../src/data/karnataka'
const shock = Number(process.argv[2] ?? 0)
const s = buildSnapshot({ ...BASELINE_SCENARIO, demandShockMW: shock, reDropMW: Number(process.argv[3] ?? 0) })
const r = solveDCPF(busInjections(s), process.argv[4] ? [process.argv[4]] : [])
console.log('drawal', s.drawalMW.toFixed(0), 'ext', s.externalImportMW.toFixed(0))
for (const l of LINES) console.log(l.id.padEnd(4), lineLabel(l.id).padEnd(40), r.flows[l.id].toFixed(0).padStart(6), (r.loading[l.id]*100).toFixed(0).padStart(4)+'%')
console.log(Object.entries(r.injections).filter(([k])=>k.startsWith('X_')).map(([k,v])=>k+':'+v.toFixed(0)).join(' '))
