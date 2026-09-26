import { useEffect, useRef, useState } from 'react'

interface CaptureProps {
  onCapture: (image: Blob) => void
}

// Simulates the Meta-glasses point-of-view: the phone's rear camera acts as
// the capture device. Falls back to file upload if the camera is unavailable
// or permission is denied (also useful for desktop debugging without a phone).
export function Capture({ onCapture }: CaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      })
      .catch((err) => {
        setCameraError(
          err instanceof Error ? err.message : 'Camera unavailable. Use image upload instead.',
        )
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
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.9)
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onCapture(file)
  }

  return (
    <div>
      <h1>Capture graph</h1>

      {cameraError ? (
        <p role="alert">{cameraError}</p>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Live camera preview of the graph, for sighted confirmation only"
        />
      )}

      <div>
        <button type="button" onClick={captureFrame} disabled={!!cameraError}>
          Capture graph
        </button>

        <label>
          Upload image instead
          <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} />
        </label>
      </div>
    </div>
  )
}
