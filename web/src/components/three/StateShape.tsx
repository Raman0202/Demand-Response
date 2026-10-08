import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { BUSES, KARNATAKA_BOUNDARY } from '@/data/topology'
import { project, shapeXY, STATE_TOP } from '@/lib/geo'

/** Extruded Karnataka landmass with a glowing border and a terrain-like gradient. */
export function StateShape() {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    KARNATAKA_BOUNDARY.forEach(([lon, lat], i) => {
      const [x, y] = shapeXY(lon, lat)
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    const g = new THREE.ExtrudeGeometry(shape, { depth: STATE_TOP, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 2 })
    g.rotateX(-Math.PI / 2)
    // vertex colours: Western Ghats (west) darker green-teal, Deccan plateau (east) slate blue
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    const west = new THREE.Color('#cdebdc')
    const east = new THREE.Color('#dbe3f4')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const t = THREE.MathUtils.clamp((x + 3.2) / 6.5, 0, 1)
      c.copy(west).lerp(east, t)
      if (pos.getY(i) < STATE_TOP - 0.01) c.multiplyScalar(0.86)
      colors.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [])

  const outline = useMemo(
    () =>
      KARNATAKA_BOUNDARY.map(([lon, lat]) => {
        const [x, z] = project(lon, lat)
        return new THREE.Vector3(x, STATE_TOP + 0.022, z)
      }),
    [],
  )

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} emissive="#f4f8ff" emissiveIntensity={0.28} />
      </mesh>
      <Line points={outline} color="#60a5fa" lineWidth={2} transparent opacity={0.9} />
      <Line points={outline.map((p) => new THREE.Vector3(p.x, 0.005, p.z))} color="#93c5fd" lineWidth={1} transparent opacity={0.5} />
    </group>
  )
}

/** Soft "load heat" pools under each substation — size ∝ load, colour ∝ stress. */
export function HeatLayer({ busLoad, stress }: { busLoad: Record<string, number>; stress: Record<string, number> }) {
  const texture = useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(cv)
  }, [])
  return (
    <group>
      {BUSES.filter((b) => !b.external && (busLoad[b.id] ?? 0) > 50).map((b) => {
        const [x, z] = project(b.lon, b.lat)
        const r = 0.25 + Math.sqrt(busLoad[b.id] ?? 0) / 55
        const s = stress[b.id] ?? 0
        const col = s >= 1 ? '#f87171' : s >= 0.9 ? '#fb923c' : s >= 0.75 ? '#fbbf24' : '#7dd3fc'
        return (
          <mesh key={b.id} position={[x, STATE_TOP + 0.004, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[r * 2, r * 2]} />
            <meshBasicMaterial map={texture} color={col} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}
