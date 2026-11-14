/**
 * One-frame preview so FrameCanvas can be checked before the Blink tool.
 */
import { useMemo, useState } from 'react'
import { limitsFromStretch } from '../core/stretch'
import type { Frame } from '../contract/types'
import type { Dataset } from '../data/dataset'
import { useWorkspaceStore } from '../state/store'
import { FrameCanvas, type FrameOverlayHelpers } from './FrameCanvas'

function drawPredicted(ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers, x: number, y: number): void {
  const { u, v } = helpers.gridToOverlay(x, y)
  const radius = 3
  const arm = 6.5
  const hair = 1.5 * helpers.cssPixel
  const halo = 3.25 * helpers.cssPixel
  const gap = 0.35

  const trace = () => {
    ctx.beginPath()
    ctx.arc(u, v, radius, 0, Math.PI * 2)
    ctx.moveTo(u - arm, v)
    ctx.lineTo(u - radius - gap, v)
    ctx.moveTo(u + radius + gap, v)
    ctx.lineTo(u + arm, v)
    ctx.moveTo(u, v - arm)
    ctx.lineTo(u, v - radius - gap)
    ctx.moveTo(u, v + radius + gap)
    ctx.lineTo(u, v + arm)
  }

  ctx.lineCap = 'round'
  ctx.strokeStyle = '#041018'
  ctx.lineWidth = halo
  trace()
  ctx.stroke()
  ctx.strokeStyle = '#e4f222'
  ctx.lineWidth = hair
  trace()
  ctx.stroke()
}

// TEMP until F7
export function BlinkStub() {
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  const [index, setIndex] = useState(0)
  const [source, setSource] = useState<Dataset | null>(dataset)
  if (source !== dataset) {
    setSource(dataset)
    setIndex(0)
    return null
  }
  if (!dataset) return null

  return <BlinkFrame dataset={dataset} index={index} onIndex={setIndex} />
}

function BlinkFrame({
  dataset,
  index,
  onIndex,
}: {
  dataset: Dataset
  index: number
  onIndex: (index: number) => void
}) {
  const n = dataset.frames.n_frames
  const limits = useMemo(() => {
    const planes: Float32Array[] = []
    for (const entry of dataset.frames.frames) {
      planes.push(dataset.framesReader.getPlane(entry.index, 0))
    }
    return limitsFromStretch(planes, dataset.meta.previews.stretch)
  }, [dataset])

  const frame: Frame | undefined = dataset.frames.frames[index]
  if (!frame) return null

  const plane = dataset.framesReader.getPlane(frame.index, 0)
  const sigma = dataset.framesReader.getPlane(frame.index, 1)
  const caption = `Frame ${frame.index}, detector D${frame.detector}, epoch ${frame.epoch_id}`
  const ariaLabel = `${caption}. Grayscale intensity in MJy/sr, north up, east left.`

  return (
    <div className="ws-blink">
      <div className="ws-blink-controls">
        <label>
          Frame
          <input
            className="ws-number"
            type="number"
            min={0}
            max={Math.max(0, n - 1)}
            step={1}
            value={index}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (!Number.isInteger(next) || next < 0 || next >= n) return
              onIndex(next)
            }}
          />
        </label>
        <span>
          Detector <span className="ws-num">D{frame.detector}</span>
        </span>
        <span className="ws-num">{caption}</span>
      </div>
      <FrameCanvas
        plane={plane}
        sigma={sigma}
        H={dataset.meta.grid.height}
        W={dataset.meta.grid.width}
        limits={limits}
        grid={dataset.meta.grid}
        pixelScaleArcsec={dataset.meta.grid.pixel_scale_arcsec}
        ariaLabel={ariaLabel}
        caption={caption}
        drawOverlay={(ctx, helpers) => {
          // target_x / target_y come from frames.json. Do not reproject them.
          drawPredicted(ctx, helpers, frame.target_x, frame.target_y)
        }}
      />
    </div>
  )
}
