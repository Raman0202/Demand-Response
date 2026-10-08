// 220 kV load channels (all DISCOMs) and generating stations from the KPTCL channel registry.
// Height ∝ live MW, colour = DISCOM (loads) or fuel (generation), top cap = data source
// (emerald = live KPTCL SLDC value, slate = simulated). A faint stem links each channel to its
// parent bus in the control model.
import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { BUS_BY_ID, DISCOM_COLORS, GEN_STATIONS, LOAD_CHANNELS } from '@/data/topology'
import type { Frame } from '@/data/types'
import { project, STATE_TOP } from '@/lib/geo'
import { useUI } from '@/store/useUI'

const FUEL_COLOR: Record<string, string> = { coal: '#64748b', hydro: '#0ea5e9', nuclear: '#8b5cf6', solar: '#eab308', wind: '#65a30d' }

export function LoadChannels({ channels }: { channels: Frame['channels'] }) {
  const hover = useUI((s) => s.hover)
  const select = useUI((s) => s.select)
  const selection = useUI((s) => s.selection)
  const stems = useMemo(
    () =>
      LOAD_CHANNELS.map((c) => {
        const [x, z] = project(c.lon, c.lat)
        const p = BUS_BY_ID[c.parent_bus]
        const [px, pz] = project(p.lon, p.lat)
        return { id: c.id, color: DISCOM_COLORS[c.discom], pts: [new THREE.Vector3(x, STATE_TOP + 0.012, z), new THREE.Vector3(px, STATE_TOP + 0.012, pz)] }
      }),
    [],
  )
  return (
    <group>
      {stems.map((s) => (
        <Line key={s.id} points={s.pts} color={s.color} lineWidth={0.8} transparent opacity={0.35} />
      ))}
      {LOAD_CHANNELS.map((c) => {
        const live = channels[c.id]
        const mw = live?.mw ?? 0
        const h = 0.03 + Math.min(0.5, (mw / 900) * 0.45)
        const [x, z] = project(c.lon, c.lat)
        const sel = selection?.kind === 'channel' && selection.id === c.id
        return (
          <group
            key={c.id}
            position={[x, STATE_TOP, z]}
            onPointerOver={(e) => {
              e.stopPropagation()
              hover({ kind: 'channel', id: c.id })
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              hover(null)
              document.body.style.cursor = 'auto'
            }}
            onClick={(e) => {
              e.stopPropagation()
              select({ kind: 'channel', id: c.id })
            }}
          >
            <mesh position={[0, h / 2, 0]}>
              <cylinderGeometry args={[0.022, 0.026, h, 6]} />
              <meshStandardMaterial color={DISCOM_COLORS[c.discom]} emissive={DISCOM_COLORS[c.discom]} emissiveIntensity={sel ? 0.6 : 0.2} />
            </mesh>
            <mesh position={[0, h + 0.006, 0]}>
              <cylinderGeometry args={[0.024, 0.024, 0.012, 6]} />
              <meshBasicMaterial color={live?.src === 'KPTCL' ? '#10b981' : '#cbd5e1'} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export function GenStations({ channels }: { channels: Frame['channels'] }) {
  const hover = useUI((s) => s.hover)
  const select = useUI((s) => s.select)
  return (
    <group>
      {GEN_STATIONS.filter((g) => g.capacityMW > 0).map((g) => {
        const mw = channels[g.id]?.mw ?? 0
        const [x, z] = project(g.lon, g.lat)
        const s = 0.035 + Math.sqrt(Math.max(0, mw)) / 600
        return (
          <group
            key={g.id}
            position={[x + 0.05, STATE_TOP + 0.05 + s, z + 0.05]}
            onPointerOver={(e) => {
              e.stopPropagation()
              hover({ kind: 'station', id: g.id })
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              hover(null)
              document.body.style.cursor = 'auto'
            }}
            onClick={(e) => {
              e.stopPropagation()
              select({ kind: 'station', id: g.id })
            }}
          >
            <mesh>
              <octahedronGeometry args={[s]} />
              <meshStandardMaterial color={FUEL_COLOR[g.type] ?? '#94a3b8'} emissive={FUEL_COLOR[g.type] ?? '#94a3b8'} emissiveIntensity={0.25} transparent opacity={0.9} />
            </mesh>
            <mesh position={[0, s + 0.008, 0]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshBasicMaterial color={channels[g.id]?.src === 'KPTCL' ? '#10b981' : '#cbd5e1'} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
