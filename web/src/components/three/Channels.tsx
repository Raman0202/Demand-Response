// 220 kV feeders (all DISCOMs) and generating stations from the KPTCL channel registry.
// Every 220 kV station is fed from its 400 kV substation: the feeder arc carries animated flow whose speed
// and thickness follow the live MW. Pillar height ∝ load, colour = DISCOM, cap = data source (emerald = live
// KPTCL, slate = simulated). A feeder whose roster group is shed turns red and dashed, its flow stops and the
// station pulses red; feeders that are part of the selected roster group glow.
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { BUS_BY_ID, DISCOM_COLORS, GEN_STATIONS, GROUP_OF_CHANNEL, LOAD_CHANNELS } from '@/data/topology'
import type { Frame } from '@/data/types'
import { project, STATE_TOP } from '@/lib/geo'
import { useUI } from '@/store/useUI'

const FUEL_COLOR: Record<string, string> = { coal: '#6a7686', hydro: '#3a6fb0', nuclear: '#7160b8', solar: '#c9a227', wind: '#5f8a2e' }
const SHED = '#b83b3a'
const PER_FEEDER = 3

export function LoadChannels({ channels, shed = {} }: { channels: Frame['channels']; shed?: Record<string, string> }) {
  const hover = useUI((s) => s.hover)
  const select = useUI((s) => s.select)
  const selection = useUI((s) => s.selection)
  const selGroup = selection?.kind === 'channel' ? GROUP_OF_CHANNEL[selection.id]?.id : null

  // feeder arcs: 400 kV parent substation → 220 kV station, lifted slightly so they read as overhead lines
  const feeders = useMemo(
    () =>
      LOAD_CHANNELS.map((c) => {
        const [x, z] = project(c.lon, c.lat)
        const p = BUS_BY_ID[c.parent_bus]
        const [px, pz] = project(p.lon, p.lat)
        const a = new THREE.Vector3(px, STATE_TOP + 0.02, pz)
        const b = new THREE.Vector3(x, STATE_TOP + 0.02, z)
        const mid = a.clone().lerp(b, 0.5)
        mid.y += 0.05 + a.distanceTo(b) * 0.12
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
        return { c, curve, pts: curve.getPoints(16) }
      }),
    [],
  )

  // flow particles for every feeder in one instanced mesh
  const inst = useRef<THREE.InstancedMesh>(null)
  const phase = useRef(0)
  const m = useMemo(() => new THREE.Matrix4(), [])
  // the animation loop reads the latest values through refs (updated after render, never during it)
  const live = useRef(channels)
  const shedRef = useRef(shed)
  useEffect(() => {
    live.current = channels
    shedRef.current = shed
  }, [channels, shed])
  useFrame((_, dt) => {
    const im = inst.current
    if (!im) return
    phase.current += dt
    feeders.forEach(({ c, curve }, i) => {
      const mw = live.current[c.id]?.mw ?? 0
      const off = !!shedRef.current[c.id]
      const speed = 0.08 + Math.min(0.6, mw / 900)
      for (let k = 0; k < PER_FEEDER; k++) {
        const u = (phase.current * speed + k / PER_FEEDER + i * 0.137) % 1
        const p = curve.getPoint(u)
        const s = off ? 0 : 0.6 + Math.min(1.2, mw / 400)
        m.makeScale(s, s, s).setPosition(p.x, p.y, p.z)
        im.setMatrixAt(i * PER_FEEDER + k, m)
      }
    })
    im.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {feeders.map(({ c, pts }) => {
        const off = !!shed[c.id]
        const inGroup = selGroup && GROUP_OF_CHANNEL[c.id]?.id === selGroup
        const mw = channels[c.id]?.mw ?? 0
        return (
          <Line
            key={`f-${c.id}`}
            points={pts}
            color={off ? SHED : DISCOM_COLORS[c.discom]}
            lineWidth={off ? 1.6 : inGroup ? 2.4 : 0.8 + Math.min(1.6, mw / 350)}
            transparent
            opacity={off ? 0.9 : inGroup ? 0.95 : 0.55}
            dashed={off}
            dashSize={0.04}
            gapSize={0.03}
          />
        )
      })}
      <instancedMesh ref={inst} args={[undefined, undefined, feeders.length * PER_FEEDER]} frustumCulled={false}>
        <sphereGeometry args={[0.009, 6, 6]} />
        <meshBasicMaterial color="#f6f7f9" toneMapped={false} />
      </instancedMesh>
      {LOAD_CHANNELS.map((c) => {
        const v = channels[c.id]
        const mw = v?.mw ?? 0
        const off = !!shed[c.id]
        const h = off ? 0.012 : 0.03 + Math.min(0.5, (mw / 900) * 0.45)
        const [x, z] = project(c.lon, c.lat)
        const sel = selection?.kind === 'channel' && selection.id === c.id
        const col = off ? SHED : DISCOM_COLORS[c.discom]
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
              <meshStandardMaterial color={col} emissive={col} emissiveIntensity={sel ? 0.6 : off ? 0.45 : 0.2} />
            </mesh>
            <mesh position={[0, h + 0.006, 0]}>
              <cylinderGeometry args={[0.024, 0.024, 0.012, 6]} />
              <meshBasicMaterial color={v?.src === 'KPTCL' ? '#2a8761' : '#c4ccd5'} toneMapped={false} />
            </mesh>
            {off && <ShedPulse />}
          </group>
        )
      })}
    </group>
  )
}

/** Pulsing red ground ring on a station whose feeders are open. */
function ShedPulse() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const k = (clock.elapsedTime * 0.9) % 1
    ref.current.scale.setScalar(0.5 + k * 1.8)
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k)
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
      <ringGeometry args={[0.05, 0.065, 32]} />
      <meshBasicMaterial color={SHED} transparent opacity={0.6} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
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
              <meshStandardMaterial color={FUEL_COLOR[g.type] ?? '#96a1ae'} emissive={FUEL_COLOR[g.type] ?? '#96a1ae'} emissiveIntensity={0.25} transparent opacity={0.9} />
            </mesh>
            <mesh position={[0, s + 0.008, 0]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshBasicMaterial color={channels[g.id]?.src === 'KPTCL' ? '#2a8761' : '#c4ccd5'} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
