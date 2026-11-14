/**
 * Shared image viewport. FRONTEND_SPEC §9.2–§9.5.
 * The only vertical flip is `toCanvasOrder`. Zoom and pan live in the workspace store.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ASINH_SOFTENING } from '../config/constants'
import { toCanvasOrder } from '../core/binary'
import { renderGrayscale, type MaskRgb, type StretchLimits } from '../core/stretch'
import { gridToOverlay, pixelToWorld, type Grid, type OverlayPoint } from '../core/wcs'
import { useWorkspaceStore, type FrameViewport } from '../state/store'
import {
  anchorZoom,
  imagePixelAt,
  placeView,
  scaleBar,
  wheelZoomFactor,
  zoomAbout,
  type ViewportSize,
} from './viewport'

/** Mask colour `#2B2F3A`. Masked pixels are never black. */
const MASK_RGB: MaskRgb = [0x2b, 0x2f, 0x3a]
const HATCH_ZOOM = 8
const HATCH_CSS = '#d7dee8'
const LETTERBOX = '#05070b'

export interface FrameOverlayHelpers {
  /** Contract grid position → overlay pixels (`u = x + 0.5`, `v = H - 0.5 - y`). */
  gridToOverlay: (x: number, y: number) => OverlayPoint
  /** Image-pixel length of one CSS pixel. Stroke widths use this to stay hairline. */
  cssPixel: number
  /** Image-pixel length of one device pixel. */
  devicePixel: number
  H: number
  W: number
}

export interface FrameCanvasProps {
  /** Intensity plane in binary order (`y = 0` southernmost). */
  plane: Float32Array
  /** Sigma plane in binary order, same shape as `plane`. */
  sigma?: Float32Array
  H: number
  W: number
  limits: StretchLimits
  grid: Grid
  pixelScaleArcsec: number
  /**
   * Draw in overlay pixel space. The context is already transformed:
   * one unit is one image pixel, origin at the top-left, y downward.
   */
  drawOverlay?: (ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers) => void
  ariaLabel: string
  caption: string
}

interface Readout {
  x: number
  y: number
  ra: number
  dec: number
  intensity: number
  sigma: number | undefined
  masked: boolean
}

interface StageProps {
  plane: Float32Array
  sigma: Float32Array | undefined
  H: number
  W: number
  grid: Grid
  pixelScaleArcsec: number
  drawOverlay: FrameCanvasProps['drawOverlay']
}

interface LocalPoint {
  x: number
  y: number
}

interface DragGesture {
  id: number
  x: number
  y: number
  panX: number
  panY: number
}

interface PinchGesture {
  ix: number
  iy: number
  dist: number
  zoom: number
}

function renderOffscreen(plane: Float32Array, H: number, W: number, limits: StretchLimits): HTMLCanvasElement | null {
  if (W <= 0 || H <= 0) return null
  const ordered = toCanvasOrder(plane, H, W)
  const rgba = new Uint8ClampedArray(W * H * 4)
  renderGrayscale(ordered, limits.lo, limits.hi, ASINH_SOFTENING, MASK_RGB, rgba)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(rgba, W, H), 0, 0)
  return canvas
}

function formatSample(value: number): string {
  if (!Number.isFinite(value)) return 'masked'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.01 || abs >= 10000)) return value.toExponential(3)
  return value.toFixed(3)
}

function formatDec(value: number): string {
  const digits = value.toFixed(5)
  return value < 0 ? digits : `+${digits}`
}

function sameView(a: FrameViewport, b: FrameViewport): boolean {
  return a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY
}

function drawMaskHatch(
  ctx: CanvasRenderingContext2D,
  plane: Float32Array,
  H: number,
  W: number,
  cssPixel: number,
): void {
  ctx.save()
  ctx.strokeStyle = HATCH_CSS
  ctx.lineWidth = 1.5 * cssPixel
  ctx.lineCap = 'butt'
  ctx.beginPath()
  for (let row = 0; row < H; row += 1) {
    const y = H - 1 - row
    const rowIndex = y * W
    for (let col = 0; col < W; col += 1) {
      const value = plane[rowIndex + col]
      if (value !== undefined && !Number.isNaN(value)) continue
      ctx.moveTo(col + 0.12, row + 0.88)
      ctx.lineTo(col + 0.88, row + 0.12)
      ctx.moveTo(col + 0.12, row + 0.5)
      ctx.lineTo(col + 0.5, row + 0.12)
      ctx.moveTo(col + 0.5, row + 0.88)
      ctx.lineTo(col + 0.88, row + 0.5)
    }
  }
  ctx.stroke()
  ctx.restore()
}

function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
  ctx.fill()
}

function drawCompass(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.fillStyle = 'rgba(5, 7, 11, 0.82)'
  fillRoundRect(ctx, 8, 8, 78, 64, 8)
  ctx.translate(47, 42)
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.beginPath()
  ctx.moveTo(0, 2)
  ctx.lineTo(0, -16)
  ctx.moveTo(-16, 0)
  ctx.lineTo(-2, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, -20)
  ctx.lineTo(-4, -12)
  ctx.lineTo(4, -12)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-20, 0)
  ctx.lineTo(-12, -4)
  ctx.lineTo(-12, 4)
  ctx.closePath()
  ctx.fill()
  ctx.fillText('N', 0, -28)
  ctx.fillText('E', -28, 0)
  ctx.restore()
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cssPerImagePx: number,
  pixelScaleArcsec: number,
): void {
  const bar = scaleBar(cssPerImagePx, pixelScaleArcsec, Math.min(cssW, cssH * 2))
  if (!bar) return
  const label = bar.label
  ctx.save()
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  const textW = ctx.measureText(label).width
  const barW = Math.min(bar.css, cssW - 24)
  const boxW = Math.max(barW, textW) + 16
  const x = 12
  const y = cssH - 36
  ctx.fillStyle = 'rgba(5, 7, 11, 0.82)'
  fillRoundRect(ctx, x, y - 16, boxW, 40, 8)
  const x0 = x + 8
  const yLine = y + 14
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(x0, yLine)
  ctx.lineTo(x0 + barW, yLine)
  ctx.moveTo(x0, yLine - 4)
  ctx.lineTo(x0, yLine + 4)
  ctx.moveTo(x0 + barW, yLine - 4)
  ctx.lineTo(x0 + barW, yLine + 4)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, x0 + barW / 2, yLine - 6)
  ctx.restore()
}

function snapTranslation(origin: number, scale: number, deviceRatio: number): number {
  const step = scale * deviceRatio
  if (Math.abs(step - Math.round(step)) > 1e-3) return origin
  return Math.round(origin * deviceRatio) / deviceRatio
}

export function FrameCanvas({
  plane,
  sigma,
  H,
  W,
  limits,
  grid,
  pixelScaleArcsec,
  drawOverlay,
  ariaLabel,
  caption,
}: FrameCanvasProps) {
  const frame = useWorkspaceStore((state) => state.tool.frame)
  const setFrame = useWorkspaceStore((state) => state.setFrame)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef(frame)
  const seenStore = useRef(frame)
  const aliveRef = useRef(true)
  const rafRef = useRef(0)
  const pointersRef = useRef(new Map<number, LocalPoint>())
  const dragRef = useRef<DragGesture | null>(null)
  const pinchRef = useRef<PinchGesture | null>(null)
  const gesturingRef = useRef(false)
  const [readout, setReadout] = useState<Readout | null>(null)
  const [panning, setPanning] = useState(false)
  const { lo, hi } = limits

  const offscreen = useMemo(() => renderOffscreen(plane, H, W, { lo, hi }), [plane, H, W, lo, hi])

  const propsRef = useRef<StageProps>({ plane, sigma, H, W, grid, pixelScaleArcsec, drawOverlay })
  propsRef.current = { plane, sigma, H, W, grid, pixelScaleArcsec, drawOverlay }
  const offscreenRef = useRef(offscreen)
  offscreenRef.current = offscreen

  if (seenStore.current !== frame) {
    seenStore.current = frame
    if (!gesturingRef.current) viewportRef.current = frame
  }

  const paintRef = useRef<() => void>(() => {})
  const scheduleRef = useRef<() => void>(() => {})

  paintRef.current = () => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    const image = offscreenRef.current
    const props = propsRef.current
    if (!canvas || !stage || !image) return
    const cssW = stage.clientWidth
    const cssH = stage.clientHeight
    if (cssW < 2 || cssH < 2) return
    const dpr = window.devicePixelRatio || 1
    const bufW = Math.max(1, Math.round(cssW * dpr))
    const bufH = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW
      canvas.height = bufH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ratioX = bufW / cssW
    const ratioY = bufH / cssH
    const size: ViewportSize = { cssW, cssH, imageW: props.W, imageH: props.H }
    const view = viewportRef.current
    const placed = placeView(size, view.zoom, view.panX, view.panY)
    const originX = snapTranslation(placed.originX, placed.scale, ratioX)
    const originY = snapTranslation(placed.originY, placed.scale, ratioY)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, bufW, bufH)
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(ratioX, 0, 0, ratioY, 0, 0)
    ctx.fillStyle = LETTERBOX
    ctx.fillRect(0, 0, cssW, cssH)

    ctx.setTransform(ratioX * placed.scale, 0, 0, ratioY * placed.scale, ratioX * originX, ratioY * originY)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, 0, 0)
    if (placed.zoom >= HATCH_ZOOM) {
      const cssPixel = placed.scale > 0 ? 1 / placed.scale : 1
      drawMaskHatch(ctx, props.plane, props.H, props.W, cssPixel)
    }
    if (props.drawOverlay && placed.scale > 0) {
      const ratio = (ratioX + ratioY) / 2
      const helpers: FrameOverlayHelpers = {
        gridToOverlay: (x, y) => gridToOverlay(x, y, props.H),
        cssPixel: 1 / placed.scale,
        devicePixel: 1 / (placed.scale * ratio),
        H: props.H,
        W: props.W,
      }
      ctx.save()
      props.drawOverlay(ctx, helpers)
      ctx.restore()
    }

    ctx.setTransform(ratioX, 0, 0, ratioY, 0, 0)
    ctx.imageSmoothingEnabled = false
    drawCompass(ctx)
    drawScaleBar(ctx, cssW, cssH, placed.scale, props.pixelScaleArcsec)
  }

  scheduleRef.current = () => {
    if (rafRef.current !== 0) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      if (!aliveRef.current) return
      paintRef.current()
      const next = viewportRef.current
      const stored = useWorkspaceStore.getState().tool.frame
      if (!sameView(stored, next)) {
        seenStore.current = next
        setFrame(next)
      }
    })
  }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      const next = viewportRef.current
      const stored = useWorkspaceStore.getState().tool.frame
      if (!sameView(stored, next)) useWorkspaceStore.getState().setFrame(next)
    }
  }, [])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const draw = () => scheduleRef.current()
    const observer = new ResizeObserver(draw)
    observer.observe(stage)
    draw()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    scheduleRef.current()
  }, [offscreen, frame.zoom, frame.panX, frame.panY, H, W, pixelScaleArcsec])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const size = readSize()
      const view = viewportRef.current
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode)
      const next = zoomAbout(
        size,
        view.zoom,
        view.panX,
        view.panY,
        event.clientX - rect.left,
        event.clientY - rect.top,
        view.zoom * factor,
      )
      viewportRef.current = next
      gesturingRef.current = pointersRef.current.size > 0
      scheduleRef.current()
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  function readSize(): ViewportSize {
    const stage = stageRef.current
    const props = propsRef.current
    return {
      cssW: stage?.clientWidth ?? 0,
      cssH: stage?.clientHeight ?? 0,
      imageW: props.W,
      imageH: props.H,
    }
  }

  function localPoint(event: { clientX: number; clientY: number }): LocalPoint {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function commit(next: FrameViewport): void {
    viewportRef.current = next
    scheduleRef.current()
  }

  function updateReadout(point: LocalPoint): void {
    const props = propsRef.current
    const size = readSize()
    const view = viewportRef.current
    const placed = placeView(size, view.zoom, view.panX, view.panY)
    const hit = imagePixelAt(placed, point.x, point.y)
    if (!hit) {
      setReadout((prev) => (prev === null ? prev : null))
      return
    }
    const x = hit.col
    const y = props.H - 1 - hit.row
    const sampleIndex = y * props.W + x
    const intensity = props.plane[sampleIndex]
    const sigmaValue = props.sigma?.[sampleIndex]
    const world = pixelToWorld(x, y, props.grid)
    const masked = intensity === undefined || Number.isNaN(intensity)
    setReadout((prev) => {
      if (
        prev &&
        prev.x === x &&
        prev.y === y &&
        prev.masked === masked &&
        prev.intensity === intensity &&
        prev.sigma === sigmaValue
      ) {
        return prev
      }
      return {
        x,
        y,
        ra: world.ra,
        dec: world.dec,
        intensity: intensity ?? Number.NaN,
        sigma: sigmaValue,
        masked,
      }
    })
  }

  function startPinch(): PinchGesture | null {
    const points = [...pointersRef.current.values()]
    const a = points[0]
    const b = points[1]
    if (!a || !b) return null
    const size = readSize()
    const view = viewportRef.current
    const placed = placeView(size, view.zoom, view.panX, view.panY)
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const scale = placed.scale > 0 ? placed.scale : 1
    return {
      ix: (midX - placed.originX) / scale,
      iy: (midY - placed.originY) / scale,
      dist: Math.max(dist, 1),
      zoom: placed.zoom,
    }
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>): void {
    if (event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is unavailable when the pointer is already inactive.
    }
    const point = localPoint(event)
    pointersRef.current.set(event.pointerId, point)
    gesturingRef.current = true
    setPanning(true)
    if (pointersRef.current.size >= 2) {
      dragRef.current = null
      pinchRef.current = startPinch()
      return
    }
    pinchRef.current = null
    const view = viewportRef.current
    dragRef.current = { id: event.pointerId, x: point.x, y: point.y, panX: view.panX, panY: view.panY }
    updateReadout(point)
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    const point = localPoint(event)
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, point)
    const pinch = pinchRef.current
    if (pinch && pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()]
      const a = points[0]
      const b = points[1]
      if (a && b) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const nextZoom = pinch.zoom * (dist / pinch.dist)
        commit(anchorZoom(readSize(), pinch.ix, pinch.iy, midX, midY, nextZoom))
      }
      return
    }
    const drag = dragRef.current
    if (drag && drag.id === event.pointerId) {
      const size = readSize()
      const placed = placeView(
        size,
        viewportRef.current.zoom,
        drag.panX + (point.x - drag.x),
        drag.panY + (point.y - drag.y),
      )
      commit({ zoom: placed.zoom, panX: placed.panX, panY: placed.panY })
    }
    updateReadout(point)
  }

  function endPointer(event: PointerEvent<HTMLCanvasElement>): void {
    pointersRef.current.delete(event.pointerId)
    if (dragRef.current?.id === event.pointerId) dragRef.current = null
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) {
      gesturingRef.current = false
      setPanning(false)
      commit(viewportRef.current)
      const rect = event.currentTarget.getBoundingClientRect()
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      if (!inside) setReadout(null)
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // The pointer may already have been released.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLCanvasElement>): void {
    const view = viewportRef.current
    const size = readSize()
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const placed = placeView(size, view.zoom, view.panX - step, view.panY)
      commit({ zoom: placed.zoom, panX: placed.panX, panY: placed.panY })
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      const placed = placeView(size, view.zoom, view.panX + step, view.panY)
      commit({ zoom: placed.zoom, panX: placed.panX, panY: placed.panY })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const placed = placeView(size, view.zoom, view.panX, view.panY - step)
      commit({ zoom: placed.zoom, panX: placed.panX, panY: placed.panY })
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      const placed = placeView(size, view.zoom, view.panX, view.panY + step)
      commit({ zoom: placed.zoom, panX: placed.panX, panY: placed.panY })
    } else if (event.key === '+' || event.key === '=' || event.key === 'Add') {
      event.preventDefault()
      commit(zoomAbout(size, view.zoom, view.panX, view.panY, size.cssW / 2, size.cssH / 2, view.zoom * 1.25))
    } else if (event.key === '-' || event.key === '_' || event.key === 'Subtract') {
      event.preventDefault()
      commit(zoomAbout(size, view.zoom, view.panX, view.panY, size.cssW / 2, size.cssH / 2, view.zoom / 1.25))
    }
  }

  function savePng(): void {
    paintRef.current()
    const canvas = canvasRef.current
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = url
    link.download = 'spherex-frame.png'
    document.body.append(link)
    link.click()
    link.remove()
  }

  const zoomLabel = `${frame.zoom.toFixed(1)}×`

  return (
    <div className="ws-frame">
      <div ref={stageRef} className="ws-frame-stage">
        <canvas
          ref={canvasRef}
          className="ws-frame-canvas"
          data-panning={panning ? 'true' : 'false'}
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={(event) => {
            if (pointersRef.current.size === 0) setReadout(null)
            else onPointerMove(event)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <p className="ws-sr" aria-live="polite" aria-atomic="true">
        {caption}
      </p>
      <div className="ws-frame-bar">
        <p className="ws-readout ws-num">
          <span className="ws-sr">Pixel readout</span>
          {readout ? (
            <>
              <span>x {readout.x}</span>
              <span>y {readout.y}</span>
              <span>RA {readout.ra.toFixed(5)}</span>
              <span>Dec {formatDec(readout.dec)}</span>
              {readout.masked ? (
                <span>masked</span>
              ) : (
                <>
                  <span>{formatSample(readout.intensity)} MJy/sr</span>
                  {readout.sigma === undefined ? null : Number.isNaN(readout.sigma) ? (
                    <span>masked</span>
                  ) : (
                    <span>σ {formatSample(readout.sigma)}</span>
                  )}
                </>
              )}
            </>
          ) : (
            <span>Hover a pixel</span>
          )}
        </p>
        <span className="ws-num ws-zoom">{zoomLabel}</span>
        <button type="button" className="ws-pill" onClick={savePng}>
          Save PNG
        </button>
      </div>
    </div>
  )
}
