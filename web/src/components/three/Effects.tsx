import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SLDC } from '@/data/topology'
import { project, STATE_TOP } from '@/lib/geo'
export type DispatchPhase = 'idle' | 'sending' | 'acking' | 'ramping' | 'done'
import { useUI as useUIStore, type CameraPreset } from '@/store/useUI'

export interface WaveTarget {
  id: string
  lon: number
  lat: number
  ok: boolean
}

/** SLDC → assets command wave (outbound amber), acknowledgements return green. */
export function CommandWave({ targets, phase }: { targets: WaveTarget[]; phase: DispatchPhase }) {
  const [sx, sz] = project(SLDC.lon, SLDC.lat)
  const start = useMemo(() => new THREE.Vector3(sx, STATE_TOP + 0.9, sz), [sx, sz])
  const curves = useMemo(
    () =>
      targets.map((t) => {
        const [x, z] = project(t.lon, t.lat)
        const end = new THREE.Vector3(x, STATE_TOP + 0.15, z)
        const mid = start.clone().lerp(end, 0.5)
        mid.y += 0.6 + start.distanceTo(end) * 0.15
        return { t, curve: new THREE.QuadraticBezierCurve3(start, mid, end) }
      }),
    [targets, start],
  )
  const dots = useRef<(THREE.Mesh | null)[]>([])
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const time = clock.elapsedTime
    curves.forEach(({ t, curve }, i) => {
      const m = dots.current[i]
      if (!m) return
      let u: number
      let color = '#f59e0b'
      if (phase === 'sending') u = Math.min(1, ((time * 0.9 + i * 0.07) % 1.4) / 1)
      else if (phase === 'acking') {
        u = 1 - ((time * 0.9 + i * 0.05) % 1.2) / 1.2
        color = t.ok ? '#22c55e' : '#ef4444'
        if (!t.ok) u = 1
      } else {
        u = (time * 0.35 + i * 0.13) % 1
        color = t.ok ? '#22c55e' : '#ef4444'
      }
      m.position.copy(curve.getPoint(u))
      ;(m.material as THREE.MeshBasicMaterial).color.set(color)
    })
    if (ring.current) {
      const k = (time * 0.8) % 1
      ring.current.scale.setScalar(0.3 + k * 6)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = phase === 'sending' ? 0.6 * (1 - k) : 0
    }
  })
  if (phase === 'idle' || !targets.length) return null
  return (
    <group>
      {curves.map(({ t, curve }, i) => (
        <group key={t.id}>
          <Line
            points={curve.getPoints(30)}
            color={phase === 'sending' ? '#f59e0b' : t.ok ? '#22c55e' : '#ef4444'}
            lineWidth={1.8}
            transparent
            opacity={phase === 'done' ? 0.35 : 0.85}
            dashed
            dashSize={0.05}
            gapSize={0.04}
          />
          <mesh ref={(el) => (dots.current[i] = el)}>
            <sphereGeometry args={[0.035, 10, 10]} />
            <meshBasicMaterial toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={ring} position={[sx, STATE_TOP + 0.02, sz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.2, 64]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

const PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = (() => {
  const t = (lon: number, lat: number): [number, number, number] => {
    const [x, z] = project(lon, lat)
    return [x, 0, z]
  }
  const blr = t(77.5, 12.95)
  const north = t(76.6, 16.4)
  const coast = t(74.9, 14.0)
  return {
    STATE: { pos: [0.4, 11.2, 8.8], target: [0, 0, 0.4] },
    BENGALURU: { pos: [blr[0] + 1.3, 3.6, blr[2] + 3.4], target: blr },
    NORTH: { pos: [north[0] + 0.5, 4.6, north[2] + 4.2], target: north },
    COAST: { pos: [coast[0] - 3, 3.4, coast[2] + 2.6], target: coast },
    TILT: { pos: [5.2, 6.4, 9.4], target: [0, 0, 0.6] },
  }
})()

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()
  const camPreset = useUIStore((s) => s.camera)
  const nonce = useUIStore((s) => s.cameraNonce)
  const anim = useRef<{ t: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3 } | null>(null)

  useEffect(() => {
    const p = PRESETS[camPreset]
    if (!controls.current) return
    anim.current = {
      t: 0,
      fromPos: camera.position.clone(),
      fromTarget: controls.current.target.clone(),
      toPos: new THREE.Vector3(...p.pos),
      toTarget: new THREE.Vector3(...p.target),
    }
  }, [camPreset, nonce, camera])

  useFrame((_, dt) => {
    const a = anim.current
    if (!a || !controls.current) return
    a.t = Math.min(1, a.t + dt / 1.1)
    const e = 1 - Math.pow(1 - a.t, 3)
    camera.position.lerpVectors(a.fromPos, a.toPos, e)
    controls.current.target.lerpVectors(a.fromTarget, a.toTarget, e)
    controls.current.update()
    if (a.t >= 1) anim.current = null
  })

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={22} maxPolarAngle={Math.PI / 2.15} target={[0, 0, 0.4]} />
}
