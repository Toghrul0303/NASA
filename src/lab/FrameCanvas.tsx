/**
 * Shared image viewport. FRONTEND_SPEC §9.2–§9.5.
 * The only vertical flip is `toCanvasOrder`. Zoom and pan live in the workspace store.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ASINH_SOFTENING } from '../config/constants'
import { toCanvasOrder } from '../core/binary'
import { MASK_RGB, renderGrayscale, type StretchLimits } from '../core/stretch'
import { gridToOverlay, pixelToWorld, type Grid, type OverlayPoint } from '../core/wcs'
import { useWorkspaceStore, type FrameViewport } from '../state/store'
import {
  anchorZoom,
  centerOnGrid,
  imagePixelAt,
  placeView,
  scaleBar,
  wheelZoomFactor,
  zoomAbout,
  type ViewportSize,
} from './viewport'

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

/** RGBA already in canvas order (row 0 at the top). Drawn instead of the stretched plane. */
export interface CanvasImage {
  rgba: Uint8ClampedArray
  width: number
  height: number
}

/** Extra hover-readout line. RGB uses slot intensities; difference imaging uses D, sigma, and S. */
export interface ReadoutRow {
  label: string
  value: string
}

interface FrameCanvasBase {
  /** Sigma plane in binary order, same shape as `plane`. */
  sigma?: Float32Array
  H: number
  W: number
  grid: Grid
  pixelScaleArcsec: number
  /**
   * Draw in overlay pixel space. The context is already transformed:
   * one unit is one image pixel, origin at the top-left, y downward.
   */
  drawOverlay?: (ctx: CanvasRenderingContext2D, helpers: FrameOverlayHelpers) => void
  ariaLabel: string
  caption: string
  /**
   * When `image` changes, blend from the previous image over this many milliseconds.
   * Skipped when the user prefers reduced motion.
   */
  crossfadeMs?: number
  /** Extra label/value rows for the hover readout, in binary pixel coordinates. */
  readoutRows?: (x: number, y: number) => readonly ReadoutRow[]
}

export type FrameCanvasProps = FrameCanvasBase &
  (
    | {
        /** Intensity plane in binary order (`y = 0` southernmost). */
        plane: Float32Array
        limits: StretchLimits
        image?: CanvasImage
      }
    | {
        plane?: Float32Array
        limits?: StretchLimits
        image: CanvasImage
      }
  )

interface Readout {
  x: number
  y: number
  ra: number
  dec: number
  intensity: number
  sigma: number | undefined
  masked: boolean
  hasPlane: boolean
  rows: readonly ReadoutRow[]
}

interface StageProps {
  plane: Float32Array | undefined
  rgba: Uint8ClampedArray | undefined
  sigma: Float32Array | undefined
  H: number
  W: number
  grid: Grid
  pixelScaleArcsec: number
  drawOverlay: FrameCanvasProps['drawOverlay']
  readoutRows: FrameCanvasProps['readoutRows']
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

function renderRgba(rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement | null {
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const pixels = ctx.createImageData(width, height)
  pixels.data.set(rgba)
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

function drawBitmap(ctx: CanvasRenderingContext2D, source: CanvasImageSource & { width: number; height: number }, destW: number, destH: number): void {
  if (source.width === destW && source.height === destH) ctx.drawImage(source, 0, 0)
  else ctx.drawImage(source, 0, 0, destW, destH)
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

function sameRows(a: readonly ReadoutRow[], b: readonly ReadoutRow[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.label !== b[i]?.label || a[i]?.value !== b[i]?.value) return false
  }
  return true
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

function drawRgbaMaskHatch(
  ctx: CanvasRenderingContext2D,
  rgba: Uint8ClampedArray,
  H: number,
  W: number,
  cssPixel: number,
): void {
  if (rgba.length !== H * W * 4) return
  const [maskR, maskG, maskB] = MASK_RGB
  ctx.save()
  ctx.strokeStyle = HATCH_CSS
  ctx.lineWidth = 1.5 * cssPixel
  ctx.lineCap = 'butt'
  ctx.beginPath()
  for (let row = 0; row < H; row += 1) {
    for (let col = 0; col < W; col += 1) {
      const offset = (row * W + col) * 4
      if (rgba[offset] !== maskR || rgba[offset + 1] !== maskG || rgba[offset + 2] !== maskB) continue
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
  image,
  crossfadeMs,
  readoutRows,
}: FrameCanvasProps) {
  const frame = useWorkspaceStore((state) => state.tool.frame)
  const frameFocus = useWorkspaceStore((state) => state.frameFocus)
  const setFrame = useWorkspaceStore((state) => state.setFrame)
  const reducedMotion = useWorkspaceStore((state) => state.ui.reducedMotion)
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
  const lo = limits?.lo
  const hi = limits?.hi
  const imageRgba = image?.rgba
  const imageWidth = image?.width
  const imageHeight = image?.height

  const offscreen = useMemo(() => {
    if (imageRgba && imageWidth && imageHeight) return renderRgba(imageRgba, imageWidth, imageHeight)
    if (plane && lo !== undefined && hi !== undefined) return renderOffscreen(plane, H, W, { lo, hi })
    return null
  }, [imageRgba, imageWidth, imageHeight, plane, H, W, lo, hi])

  const propsRef = useRef<StageProps>({ plane, rgba: imageRgba, sigma, H, W, grid, pixelScaleArcsec, drawOverlay, readoutRows })
  propsRef.current = { plane, rgba: imageRgba, sigma, H, W, grid, pixelScaleArcsec, drawOverlay, readoutRows }
  const offscreenRef = useRef(offscreen)
  offscreenRef.current = offscreen
  const committedRef = useRef<HTMLCanvasElement | null>(null)
  const fadeFromRef = useRef<HTMLCanvasElement | null>(null)
  const fadeTRef = useRef(1)
  const lastPointRef = useRef<LocalPoint | null>(null)
  const updateReadoutRef = useRef<(point: LocalPoint) => void>(() => {})

  if (seenStore.current !== frame) {
    seenStore.current = frame
    if (!gesturingRef.current) viewportRef.current = frame
  }

  const paintRef = useRef<() => void>(() => {})
  const scheduleRef = useRef<() => void>(() => {})
  const appliedFocus = useRef<typeof frameFocus>(null)
  const centerRef = useRef<() => void>(() => {})
  centerRef.current = () => {
    if (!frameFocus) {
      appliedFocus.current = null
      return
    }
    if (appliedFocus.current === frameFocus) return
    const stage = stageRef.current
    if (!stage || stage.clientWidth < 2 || stage.clientHeight < 2) return
    const size: ViewportSize = {
      cssW: stage.clientWidth,
      cssH: stage.clientHeight,
      imageW: W,
      imageH: H,
    }
    appliedFocus.current = frameFocus
    const next = centerOnGrid(size, viewportRef.current.zoom, frameFocus.x, frameFocus.y, H)
    viewportRef.current = next
    seenStore.current = next
  }

  paintRef.current = () => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    const bitmap = offscreenRef.current
    const props = propsRef.current
    if (!canvas || !stage || !bitmap) return
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
    const fadeFrom = fadeFromRef.current
    const fadeT = fadeTRef.current
    if (fadeFrom && fadeT < 1) {
      ctx.globalAlpha = 1 - fadeT
      drawBitmap(ctx, fadeFrom, props.W, props.H)
      ctx.globalAlpha = fadeT
      drawBitmap(ctx, bitmap, props.W, props.H)
      ctx.globalAlpha = 1
    } else {
      drawBitmap(ctx, bitmap, props.W, props.H)
    }
    if (placed.zoom >= HATCH_ZOOM) {
      const cssPixel = placed.scale > 0 ? 1 / placed.scale : 1
      if (props.rgba) drawRgbaMaskHatch(ctx, props.rgba, props.H, props.W, cssPixel)
      else if (props.plane) drawMaskHatch(ctx, props.plane, props.H, props.W, cssPixel)
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
    const draw = () => {
      centerRef.current()
      scheduleRef.current()
    }
    const observer = new ResizeObserver(draw)
    observer.observe(stage)
    draw()
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    centerRef.current()
    scheduleRef.current()
  }, [frameFocus, H, W])

  useLayoutEffect(() => {
    const next = offscreen
    const prev = committedRef.current
    if (!next) return undefined
    const duration = reducedMotion ? 0 : (crossfadeMs ?? 0)
    const shouldFade = prev !== null && prev !== next && duration > 0
    committedRef.current = next
    if (!shouldFade) {
      fadeFromRef.current = null
      fadeTRef.current = 1
      scheduleRef.current()
      return undefined
    }
    fadeFromRef.current = prev
    fadeTRef.current = 0
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      fadeTRef.current = t
      if (t >= 1) fadeFromRef.current = null
      scheduleRef.current()
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    scheduleRef.current()
    return () => cancelAnimationFrame(raf)
  }, [offscreen, crossfadeMs, reducedMotion])

  useEffect(() => {
    const point = lastPointRef.current
    if (!point) return
    updateReadoutRef.current(point)
  }, [readoutRows, imageRgba, plane])

  useEffect(() => {
    // `drawOverlay` is read from props at paint time. Without it here, toggling
    // an overlay (or stepping to a frame whose overlay closure changed while the
    // offscreen image stayed cached) would leave the previous vectors on screen.
    scheduleRef.current()
  }, [offscreen, frame.zoom, frame.panX, frame.panY, H, W, pixelScaleArcsec, drawOverlay])

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
    lastPointRef.current = point
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
    const hasPlane = props.plane !== undefined
    const intensity = hasPlane ? props.plane?.[sampleIndex] : undefined
    const sigmaValue = props.sigma?.[sampleIndex]
    const world = pixelToWorld(x, y, props.grid)
    const masked = hasPlane && (intensity === undefined || Number.isNaN(intensity))
    const rows = props.readoutRows?.(x, y) ?? []
    setReadout((prev) => {
      if (
        prev &&
        prev.x === x &&
        prev.y === y &&
        prev.masked === masked &&
        prev.hasPlane === hasPlane &&
        prev.intensity === intensity &&
        prev.sigma === sigmaValue &&
        sameRows(prev.rows, rows)
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
        hasPlane,
        rows,
      }
    })
  }

  updateReadoutRef.current = updateReadout

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
      <div className="rounded-2xl bg-white dark:bg-[#0A0B10]/85 backdrop-blur-md border border-black/15 dark:border-white/12 px-3.5 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3">
        <p className="ws-readout font-mono tabular-nums text-zinc-900 dark:text-white/90">
          <span className="ws-sr">Pixel readout</span>
          {readout ? (
            <>
              <span>x {readout.x}</span>
              <span>y {readout.y}</span>
              <span>RA {readout.ra.toFixed(5)}</span>
              <span>Dec {formatDec(readout.dec)}</span>
              {readout.hasPlane ? (
                readout.masked ? (
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
                )
              ) : null}
              {readout.rows.map((row) => (
                <span key={`${row.label}:${row.value}`}>
                  {row.label} {row.value}
                </span>
              ))}
            </>
          ) : (
            <span className="text-zinc-500 dark:text-[#A1A1AA]">Hover a pixel</span>
          )}
        </p>
        <span className="font-mono tabular-nums text-xs text-zinc-600 dark:text-[#A1A1AA]">{zoomLabel}</span>
        <button type="button" className="liquid-glass-cta rounded-full px-3.5 py-1 text-xs font-medium" onClick={savePng}>
          Save PNG
        </button>
      </div>
    </div>
  )
}
