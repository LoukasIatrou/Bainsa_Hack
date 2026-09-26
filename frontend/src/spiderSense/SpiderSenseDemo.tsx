import { useMemo, useState } from 'react'
import { SpiderSense } from './SpiderSense'
import { buildCurve } from './logic'
import type { SpiderSenseState } from './logic'

// Standalone test harness for the circle. Open the app with #spider-sense in the URL.
const WIDTH = 720
const HEIGHT = 420

function fmt(n: number | null | undefined, digits = 0): string {
  return n === null || n === undefined ? '-' : n.toFixed(digits)
}

export function SpiderSenseDemo() {
  const [session, setSession] = useState(0)
  const [state, setState] = useState<SpiderSenseState | null>(null)

  const curve = useMemo(
    () =>
      buildCurve(
        (x) => Math.sin(x) + 0.3 * Math.sin(2.5 * x),
        [0, 4 * Math.PI],
        [-1.6, 1.6],
        { width: WIDTH, height: HEIGHT, padding: 30 },
      ),
    [],
  )

  function restart() {
    setSession((s) => s + 1)
    setState(null)
  }

  const angleDeg = state?.angle != null ? (state.angle * 180) / Math.PI : null

  return (
    <div className="spider-sense-demo">
      <h1>Spider-sense circle</h1>
      <SpiderSense key={session} curve={curve} width={WIDTH} height={HEIGHT} onStateChange={setState} />
      <p className="spider-sense-demo__readout">
        phase: {state?.phase ?? 'searching'} · pointer: {fmt(state?.pointer?.x)},{fmt(state?.pointer?.y)} ·
        distance: {fmt(state?.distance)} · angle: {fmt(angleDeg)}° · contact:{' '}
        {state?.lastContact ? `${fmt(state.lastContact.x)},${fmt(state.lastContact.y)}` : 'none'}
      </p>
      <button type="button" onClick={restart}>
        Restart curve
      </button>
    </div>
  )
}
