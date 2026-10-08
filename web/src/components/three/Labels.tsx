// Screen-space label layer for the 3D map.
// Labels are ordinary DOM rendered once by React over the canvas; <LabelProjector> (inside the
// Canvas) re-positions them every frame. Unlike drei <Html>, this creates no extra React roots,
// so mounting/unmounting the map is safe under React 19.
import { useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

export interface MapLabel {
  id: string
  pos: [number, number, number]
  node: ReactNode
  priority?: number // higher draws on top
}

export function LabelProjector({ labels, layer }: { labels: MapLabel[]; layer: RefObject<HTMLDivElement | null> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  const cache = useRef(new Map<string, HTMLElement>())
  useFrame(({ camera, size }) => {
    const root = layer.current
    if (!root) return
    for (const l of labels) {
      let el = cache.current.get(l.id)
      if (!el || !el.isConnected) {
        el = root.querySelector<HTMLElement>(`[data-label-id="${l.id}"]`) ?? undefined
        if (!el) continue
        cache.current.set(l.id, el)
      }
      v.set(l.pos[0], l.pos[1], l.pos[2]).project(camera)
      const behind = v.z > 1
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`
      el.style.opacity = behind ? '0' : '1'
    }
  })
  return null
}

export function LabelLayer({ labels, layer }: { labels: MapLabel[]; layer: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden">
      {labels.map((l) => (
        <div key={l.id} data-label-id={l.id} className="absolute top-0 left-0 opacity-0 will-change-transform" style={{ zIndex: l.priority ?? 1 }}>
          {l.node}
        </div>
      ))}
    </div>
  )
}
