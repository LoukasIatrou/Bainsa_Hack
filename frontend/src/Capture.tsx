import { useEffect, useRef, useState } from 'react'
import { announce } from './speech'

interface CaptureProps {
  onCapture: (image: Blob) => void
}

type CameraStatus = 'requesting' | 'ready' | 'error'

// Simulates the Meta-glasses point-of-view: the phone's rear camera acts as
// the capture device. The whole screen is a single capture button rather
// than a small on-screen control, since a blind user can't visually aim at
// a small target - tapping anywhere works, and with TalkBack/VoiceOver on,
// one tap announces the label and a second tap activates it as normal.
//
// No upload fallback for now (removed on request) - the team brief lists
// image upload as a required alternative capture route, so this should
// come back before the final demo checklist.
export function Capture({ onCapture }: CaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<CameraStatus>('requesting')
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        const video = videoRef.current
        if (!video) return
        video.srcObject = s
        // Some mobile browsers don't reliably autoplay after srcObject is
        // set imperatively, even with the autoPlay attribute - kick it off
        // explicitly so the feed doesn't sit on a black frame.
        video.play().then(() => setStatus('ready')).catch((err) => {
          setCameraError(err instanceof Error ? err.message : 'Could not start camera preview.')
          setStatus('error')
        })
      })
      .catch((err) => {
        setCameraError(err instanceof Error ? err.message : 'Camera unavailable.')
        setStatus('error')
      })

    return () => {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  function captureFrame() {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      // Immediate confirmation at the moment of the tap, before the network round-trip -
      // a blind user has no visual cue that the tap registered otherwise.
      announce('Graph captured. Processing.')
      onCapture(blob)
    }, 'image/jpeg', 0.9)
  }

  return (
    <div className="capture-screen">
      <button
        type="button"
        onClick={captureFrame}
        disabled={status !== 'ready'}
        className="capture-surface"
        aria-label="Point the camera at the graph, then tap anywhere on the screen to capture it"
      >
        <video ref={videoRef} autoPlay playsInline muted aria-hidden="true" />
      </button>

      {status !== 'ready' && (
        <p className="capture-status" role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
          {status === 'error' ? cameraError : 'Requesting camera access...'}
        </p>
      )}
    </div>
  )
}
