import clipping from 'polygon-clipping'
import type { MultiPolygon, Ring } from 'polygon-clipping'
import { SVGPathData } from 'svg-pathdata'

export type Point = [number, number]
export type Direction = 'right' | 'down' | 'left' | 'up'
export type CharacterData = { strokes: string[]; medians: number[][][] }
export type StrokeModel = { outline: MultiPolygon; median: Point[]; cuts: number[] }
export type StrokeSettings = { cuts: number[]; directions: Direction[]; durations: number[] }
export type Bounds = { x: number; y: number; width: number; height: number }
export type Segment = {
  stroke: number; part: number; geometry: MultiPolygon; path: string
  bounds: Bounds; direction: Direction; duration: number
}

export const DIRECTIONS: Record<Direction, string> = {
  right: '→ 自左侧', down: '↓ 自顶部', left: '← 自右侧', up: '↑ 自底部',
}
export const MIN_CUT_GAP = 0.025
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

function lineDistance(p: Point, a: Point, b: Point) {
  const length = distance(a, b)
  if (!length) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length ** 2))
  return distance(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
}

// Adaptive Bezier flattening: at most 0.35 units of error in the 1024-unit glyph.
function flattenCurve(a: Point, b: Point, c: Point, d: Point, out: Point[], depth = 0) {
  if (depth >= 14 || Math.max(lineDistance(b, a, d), lineDistance(c, a, d)) < 0.35) {
    out.push(d)
    return
  }
  const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d)
  const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd)
  flattenCurve(a, ab, abc, center, out, depth + 1)
  flattenCurve(center, bcd, cd, d, out, depth + 1)
}

function ringArea(ring: Ring) {
  return ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]
    return sum + p[0] * q[1] - q[0] * p[1]
  }, 0) / 2
}

function contains(ring: Ring, point: Point) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

export function flattenOutline(path: string): MultiPolygon {
  const commands = new SVGPathData(path).toAbs().normalizeHVZ().normalizeST().qtToC().aToC().commands
  const rings: Ring[] = []
  let ring: Ring = [], current: Point = [0, 0]
  const finish = () => {
    if (ring.length > 2) {
      if (distance(ring[0], ring[ring.length - 1]) > 1e-8) ring.push([...ring[0]])
      if (Math.abs(ringArea(ring)) > 1e-8) rings.push(ring)
    }
    ring = []
  }
  for (const command of commands) {
    if (command.type === SVGPathData.CLOSE_PATH) { finish(); continue }
    if (!('x' in command) || !('y' in command)) throw new Error('无法解析该笔画轮廓')
    const end: Point = [command.x, 900 - command.y]
    if (command.type === SVGPathData.MOVE_TO) { finish(); ring.push(end) }
    else if (command.type === SVGPathData.CURVE_TO) {
      flattenCurve(current, [command.x1, 900 - command.y1], [command.x2, 900 - command.y2], end, ring)
    } else if (command.type === SVGPathData.LINE_TO) ring.push(end)
    else throw new Error('不支持的笔画轮廓命令')
    current = end
  }
  finish()
  // Honor nonzero winding, including opposite-winding nested holes.
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
  let geometry: MultiPolygon = []
  rings.forEach((r, index) => {
    const winding = rings.slice(0, index).reduce((sum, parent) =>
      sum + (contains(parent, r[0]) ? Math.sign(ringArea(parent)) : 0), 0)
    if (winding === 0) geometry = clipping.union(geometry, [r])
    else if (winding + Math.sign(ringArea(r)) === 0) geometry = clipping.difference(geometry, [r])
  })
  if (!geometry.length) throw new Error('笔画轮廓为空')
  return geometry
}

function distances(points: Point[]) {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]))
  return lengths
}

export function pointAt(points: Point[], fraction: number): Point {
  const lengths = distances(points), target = fraction * lengths[lengths.length - 1]
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] >= target) {
      const t = (target - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1)
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
    }
  }
  return points[points.length - 1]
}

function simplifiedIndices(points: Point[], first = 0, last = points.length - 1): number[] {
  let max = 10, index = -1
  for (let i = first + 1; i < last; i++) {
    const d = lineDistance(points[i], points[first], points[last])
    if (d > max) { max = d; index = i }
  }
  if (index < 0) return [first, last]
  return [...simplifiedIndices(points, first, index).slice(0, -1), ...simplifiedIndices(points, index, last)]
}

export function detectCuts(median: Point[]): number[] {
  const indices = simplifiedIndices(median), lengths = distances(median)
  const total = lengths[lengths.length - 1], cuts: number[] = []
  for (let i = 1; i < indices.length - 1; i++) {
    const a = median[indices[i - 1]], b = median[indices[i]], c = median[indices[i + 1]]
    const fraction = lengths[indices[i]] / total
    // Axis changes locate candidates on both sharp corners and gradual arcs.
    // They are not sufficient evidence of a turn (a dot can cross 45 degrees).
    if (directionBetween(a, b) !== directionBetween(b, c) &&
      fraction - (cuts.at(-1) ?? 0) >= MIN_CUT_GAP && 1 - fraction >= MIN_CUT_GAP) cuts.push(fraction)
  }
  // Median endpoints often include brush-tip flourishes rather than another stroke leg.
  if (cuts.length && cuts[0] * total < 45) cuts.shift()
  if (cuts.length && (1 - cuts[cuts.length - 1]) * total < 45) cuts.pop()
  for (let i = 0; i < cuts.length;) {
    const a = pointAt(median, cuts[i - 1] ?? 0), b = pointAt(median, cuts[i]), c = pointAt(median, cuts[i + 1] ?? 1)
    const cosine = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) /
      (distance(a, b) * distance(b, c) || 1)
    const gentle = cosine > Math.cos(50 * Math.PI / 180)
    if (directionBetween(a, b) === directionBetween(b, c) || distance(a, b) < 25 ||
      (gentle && canWipeTogether(median, cuts[i - 1] ?? 0, cuts[i + 1] ?? 1))) {
      cuts.splice(i, 1)
      // Recheck the preceding boundary against the newly joined span.
      i = Math.max(0, i - 1)
    }
    else i++
  }
  return cuts
}

function directionBetween(a: Point, b: Point): Direction {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  return Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up')
}

function wholeStrokeDirection(a: Point, b: Point): Direction {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  // A vertical wipe follows dots and diagonal strokes in writing order, even
  // when their horizontal extent is slightly larger. Shallow strokes stay horizontal.
  return Math.abs(dy) >= Math.abs(dx) * 0.5 ? (dy >= 0 ? 'down' : 'up') : (dx >= 0 ? 'right' : 'left')
}

function canWipeTogether(median: Point[], start: number, end: number) {
  const a = pointAt(median, start), b = pointAt(median, end)
  const direction = wholeStrokeDirection(a, b)
  const axis = direction === 'left' || direction === 'right' ? 0 : 1
  const sign = direction === 'left' || direction === 'up' ? -1 : 1
  const lengths = distances(median), total = lengths.at(-1)!
  const points = [a, ...median.filter((_, i) => lengths[i] > start * total && lengths[i] < end * total), b]
  let furthest = a[axis] * sign
  // Tolerate small median wiggles, but never merge a hook that doubles back.
  for (const point of points) {
    const progress = point[axis] * sign
    if (furthest - progress > 10) return false
    furthest = Math.max(furthest, progress)
  }
  return true
}

export function analyzeCharacter(data: CharacterData): StrokeModel[] {
  if (!data.strokes.length || data.strokes.length !== data.medians?.length) throw new Error('缺少配套的笔画轨迹，暂时无法生成 PPT')
  return data.strokes.map((path, i) => {
    const median = data.medians[i].map((p): Point => {
      if (p.length !== 2 || !p.every(Number.isFinite)) throw new Error('笔画轨迹数据无效')
      return [p[0], 900 - p[1]]
    }).filter((p, j, all) => j === 0 || distance(p, all[j - 1]) > 0.01)
    if (median.length < 2) throw new Error(`第 ${i + 1} 笔的轨迹不完整`)
    return { outline: flattenOutline(path), median, cuts: detectCuts(median) }
  })
}

export function defaultSettings(model: StrokeModel, cuts = model.cuts): StrokeSettings {
  const stops = [0, ...cuts, 1], lengths = distances(model.median), total = lengths.at(-1)!
  const directions: Direction[] = [], durations: number[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const a = pointAt(model.median, stops[i]), b = pointAt(model.median, stops[i + 1])
    directions.push(cuts.length ? directionBetween(a, b) : wholeStrokeDirection(a, b))
    durations.push(Math.max(150, Math.round(total * (stops[i + 1] - stops[i]) / 0.5)))
  }
  return { cuts: [...cuts], directions, durations }
}

export function validSettings(value: unknown, count: number): value is StrokeSettings[] {
  if (!Array.isArray(value) || value.length !== count) return false
  return value.every(v => v && Array.isArray(v.cuts) && v.cuts.length < 32 &&
    v.cuts.every((c: number, i: number) => Number.isFinite(c) && c - (v.cuts[i - 1] ?? 0) >= MIN_CUT_GAP - 1e-8 && c <= 1 - MIN_CUT_GAP) &&
    Array.isArray(v.directions) && v.directions.length === v.cuts.length + 1 && v.directions.every((d: string) => Object.hasOwn(DIRECTIONS, d)) &&
    Array.isArray(v.durations) && v.durations.length === v.directions.length && v.durations.every((d: number) => Number.isFinite(d) && d >= 100 && d <= 10000))
}

function clipHalfPlane(polygon: Ring, nx: number, ny: number, limit: number): Ring {
  const out: Ring = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit
    if (da <= 0) out.push(a)
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db)
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
  }
  return out
}

export function boundsOf(geometry: MultiPolygon): Bounds {
  const points = geometry.flat(2), xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export function geometryPath(geometry: MultiPolygon): string {
  return geometry.flatMap(polygon => polygon.map(ring => ring.map((p, i) =>
    `${i ? 'L' : 'M'}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(' ') + 'Z')).join(' ')
}

export function geometryArea(geometry: MultiPolygon): number {
  return geometry.reduce((sum, polygon) => sum + Math.abs(ringArea(polygon[0])) -
    polygon.slice(1).reduce((holes, r) => holes + Math.abs(ringArea(r)), 0), 0)
}

export function splitStroke(model: StrokeModel, settings: StrokeSettings, stroke = 0): Segment[] {
  if (!validSettings([settings], 1)) throw new Error('分段设置无效，请恢复自动拆分')
  const stops = [0, ...settings.cuts, 1]
  let geometries: MultiPolygon[] = [model.outline]
  if (settings.cuts.length) {
    const total = distances(model.median).at(-1)!
    const sites: { point: Point; part: number }[] = []
    for (let part = 0; part < stops.length - 1; part++) {
      const count = Math.max(2, Math.ceil(total * (stops[part + 1] - stops[part]) / 18))
      for (let j = 0; j < count; j++) {
        const t = stops[part] + (stops[part + 1] - stops[part]) * (j + 0.5) / count
        const point = pointAt(model.median, t)
        if (!sites.some(s => distance(s.point, point) < 1e-6)) sites.push({ point, part })
      }
    }
    const bounds = boundsOf(model.outline), margin = 4
    const cells: MultiPolygon[] = stops.slice(1).map(() => [])
    // Nearest-trajectory Voronoi cells form a complete, non-overlapping partition.
    // Unlike infinite cuts at each turn, this also handles strokes that double back.
    sites.forEach((site, i) => {
      let cell: Ring = [[bounds.x - margin, bounds.y - margin], [bounds.x + bounds.width + margin, bounds.y - margin],
        [bounds.x + bounds.width + margin, bounds.y + bounds.height + margin], [bounds.x - margin, bounds.y + bounds.height + margin]]
      for (let j = 0; j < sites.length && cell.length; j++) {
        if (i === j) continue
        const p = site.point, q = sites[j].point
        cell = clipHalfPlane(cell, q[0] - p[0], q[1] - p[1], (q[0] ** 2 + q[1] ** 2 - p[0] ** 2 - p[1] ** 2) / 2)
      }
      // Snap shared cell vertices to the same grid before the boolean union.
      // Independently clipped cells otherwise differ by floating-point epsilon.
      if (cell.length >= 3) cells[site.part].push([cell.map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6])])
    })
    geometries = cells.map(parts => parts.length ? clipping.intersection(model.outline, clipping.union(parts)) : [])
  }
  return geometries.map((geometry, part) => {
    if (geometryArea(geometry) < 0.01) throw new Error(`第 ${stroke + 1} 笔的切点产生了空片段，请移动或删除切点`)
    return { stroke, part, geometry, path: geometryPath(geometry), bounds: boundsOf(geometry),
      direction: settings.directions[part], duration: settings.durations[part] }
  })
}

export function animationTimeline(segments: Segment[], gap: number, speed = 1) {
  let cursor = 0
  return segments.map((segment, i) => {
    const delay = i === 0 ? 250 : segment.stroke !== segments[i - 1].stroke ? gap : 0
    const duration = Math.max(50, Math.round(segment.duration / speed))
    const start = cursor + delay
    cursor = start + duration
    return { segment, start, duration, delay, end: cursor }
  })
}
