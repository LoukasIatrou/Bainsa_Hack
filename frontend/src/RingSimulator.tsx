export type PullDirection = 'rising' | 'falling' | 'flat' | 'unknown'

interface RingSimulatorProps {
  index: number
  length: number
  direction: PullDirection
}

// docs/phone-demo-navigation.md §4: the ring has two independent visual layers keyed off the
// same index - a position dot (how far through the series) and a pulse flash (local trend
// direction between the previous and current point). Neither layer stands in for real hardware,
// so the label always says "simulated".
const DIRECTION_LABEL: Record<PullDirection, string> = {
  rising: 'rising pulse',
  falling: 'falling pulse',
  flat: 'steady pulse',
  unknown: 'starting point',
}

export function RingSimulator({ index, length, direction }: RingSimulatorProps) {
  const angle = length > 1 ? (index / (length - 1)) * 360 : 0

  return (
    <div className="ring">
      <div className="ring-track">
        <div className="ring-dot" style={{ transform: `rotate(${angle}deg)` }} />
        <div className={`ring-pulse ring-pulse--${direction}`} />
      </div>
      <p className="ring-label" role="status" aria-live="polite">
        Simulated ring: {DIRECTION_LABEL[direction]}
      </p>
    </div>
  )
}
