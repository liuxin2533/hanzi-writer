import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { animationTimeline, geometryPath } from './stroke-split.ts'
import type { Segment, StrokeModel } from './stroke-split.ts'
import type { MultiPolygon } from 'polygon-clipping'

export type DrawingStyle = {
  grid: boolean; ghost: boolean; gridBorderColor: string; gridBorderWidth: number
  gridDashedColor: string; gridDashedWidth: number; ghostColor: string; strokeColor: string; currentStrokeColor: string
}
export const DEFAULT_STYLE: DrawingStyle = {
  grid: true, ghost: true, gridBorderColor: '#8b7355', gridBorderWidth: 4,
  gridDashedColor: '#8b7355', gridDashedWidth: 2, ghostColor: '#d4c5b0', strokeColor: '#1a1a1a', currentStrokeColor: '#c41e3a',
}
const color = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '1a1a1a'
const shapeName = (character: string, segment: Segment) => `${character}-${segment.stroke + 1}-part-${segment.part + 1}`
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const drawingCanvas = (style: DrawingStyle) => {
  const padding = style.grid ? Math.ceil(Math.max(1, style.gridBorderWidth * 2 - 8, style.gridDashedWidth * 2)) : 1
  return { padding, extent: 1024 + padding * 2 }
}

// Mirrors PowerPoint's automatic, after-previous entrance sequence.
// OOXML's wipe filter names the origin edge: wipe(up) reveals from top to bottom.
// Verified against PowerPoint's rendered frames, not just the animation enum names.
export function buildTiming(segments: Segment[], shapeIds: number[], gap: number, speed: number, style: DrawingStyle): string {
  if (shapeIds.length !== segments.length || shapeIds.some(id => !Number.isInteger(id) || id < 1)) throw new Error('PPT 动画对象匹配失败')
  let node = 4
  const subtype = { down: 1, left: 2, up: 4, right: 8 }
  const filter = { down: 'up', left: 'right', up: 'down', right: 'left' }
  // Native color behaviors update the existing objects, including their seam-hiding
  // outlines. Do not duplicate geometry to represent current/completed strokes.
  const changeColor = (shapeId: number, fill: string) => ['fillcolor', 'stroke.color'].map(attribute =>
    `<p:animClr clrSpc="rgb" dir="cw"><p:cBhvr><p:cTn id="${node++}" dur="1" fill="hold"/>
    <p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>${attribute}</p:attrName></p:attrNameLst>
    </p:cBhvr><p:to><a:srgbClr val="${color(fill)}"/></p:to></p:animClr>`).join('')
  const effects = animationTimeline(segments, gap, speed).map(({ segment, start, duration, delay }, index) => {
    const ids = [node++, node++, node++, node++]
    const target = `<p:tgtEl><p:spTgt spid="${shapeIds[index]}"/></p:tgtEl>`
    const highlight = changeColor(shapeIds[index], style.currentStrokeColor)
    // Reset every part together as soon as this whole stroke ends, including
    // the final stroke. Inter-stroke pauses must already show the regular color.
    const completed = segment.stroke !== segments[index + 1]?.stroke
      ? segments.slice(0, index + 1).flatMap((previous, i) => previous.stroke === segment.stroke ? [
        `<p:par><p:cTn id="${node++}" presetID="1" presetClass="emph" presetSubtype="2" fill="hold" nodeType="withEffect">
        <p:stCondLst><p:cond delay="${delay + duration}"/></p:stCondLst><p:childTnLst>${changeColor(shapeIds[i], style.strokeColor)}</p:childTnLst></p:cTn></p:par>`,
      ] : []).join('') : ''
    return `<p:par><p:cTn id="${ids[0]}" fill="hold"><p:stCondLst><p:cond delay="${start - delay}"/></p:stCondLst><p:childTnLst>
      <p:par><p:cTn id="${ids[1]}" presetID="22" presetClass="entr" presetSubtype="${subtype[segment.direction]}" fill="hold" grpId="0" nodeType="afterEffect">
      <p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>
      <p:set><p:cBhvr><p:cTn id="${ids[2]}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${target}
      <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
      <p:animEffect transition="in" filter="wipe(${filter[segment.direction]})"><p:cBhvr><p:cTn id="${ids[3]}" dur="${duration}"/>${target}</p:cBhvr></p:animEffect>
      ${highlight}</p:childTnLst></p:cTn></p:par>${completed}</p:childTnLst></p:cTn></p:par>`
  }).join('')
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
    <p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
    <p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst>
    <p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>
    <p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
    <p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>
    </p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>
    <p:bldLst>${shapeIds.map(id => `<p:bldP spid="${id}" grpId="0" animBg="1"/>`).join('')}</p:bldLst></p:timing>`
}

export async function createStrokePptx(character: string, models: StrokeModel[], segments: Segment[], style: DrawingStyle, gap = 180, speed = 1): Promise<ArrayBuffer> {
  if (!segments.length || !Number.isFinite(gap) || gap < 0 || !Number.isFinite(speed) || speed <= 0) throw new Error('没有可导出的笔画或播放设置无效')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '笔墨 · 习字'
  pptx.subject = '汉字分段笔顺动画'
  pptx.title = `${character} · 笔顺动画`
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }
  const size = 5.8, x = (13.333333 - size) / 2, y = (7.5 - size) / 2, scale = size / 1024
  const { padding, extent } = drawingCanvas(style)
  const canvasBox = { x: x - padding * scale, y: y - padding * scale, w: extent * scale, h: extent * scale }
  const addGeometry = (geometry: MultiPolygon, fill: string, objectName: string) => {
    // Keep every selectable object on the same canvas. Native custom geometry
    // preserves the ink's offset within it, and PowerPoint wipes the ink bounds.
    const points: NonNullable<PptxGenJS.ShapeProps['points']> = geometry.flatMap(polygon => polygon.flatMap(ring => [
      ...ring.slice(0, -1).map((p, i) => ({ x: (p[0] + padding) * scale, y: (p[1] + padding) * scale, moveTo: i === 0 })),
      { close: true as const },
    ]))
    // PptxGenJS 4 supports custGeom at runtime, but omits it from its ShapeType enum.
    slide.addShape('custGeom' as PptxGenJS.ShapeType, {
      ...canvasBox, points,
      // A subpixel outline hides antialiasing seams where two independent shapes meet.
      fill: { color: color(fill) }, line: { color: color(fill), width: 0.15 }, objectName,
    })
  }
  if (style.grid || style.ghost) {
    // A single SVG picture has no expandable child objects in PowerPoint.
    // PptxGenJS also creates a PNG fallback in the browser for older readers.
    // Padding preserves thick grid strokes while keeping the glyph aligned.
    const grid = style.grid ? `<rect x="8" y="8" width="1008" height="1008" fill="none" stroke="#${color(style.gridBorderColor)}" stroke-width="${style.gridBorderWidth * 4}"/>
      <path d="M0 512H1024M512 0V1024M0 0L1024 1024M1024 0L0 1024" fill="none" stroke="#${color(style.gridDashedColor)}" stroke-width="${style.gridDashedWidth * 4}" opacity="0.6" stroke-dasharray="32 24"/>` : ''
    const ghost = style.ghost ? models.map(model => `<path d="${geometryPath(model.outline)}" fill="#${color(style.ghostColor)}" stroke="#${color(style.ghostColor)}" stroke-width="${0.15 / (scale * 72)}"/>`).join('') : ''
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${extent}" height="${extent}" viewBox="${-padding} ${-padding} ${extent} ${extent}">${grid}${ghost}</svg>`
    slide.addImage({ ...canvasBox, data: `data:image/svg+xml;base64,${btoa(svg)}`,
      objectName: escapeXml(`${character}-0`), altText: `${character}的格线与底字` })
  }
  // Outside slideshow playback, the whole character is a ghost. Animation
  // behaviors supply the current and completed colors without extra objects.
  segments.forEach(segment => addGeometry(segment.geometry, style.ghostColor, shapeName(character, segment)))
  slide.addNotes(`汉字：${character}\n原笔画：${models.length}，动画片段：${segments.length}。进入放映后自动书写。\n字形来源：Hanzi Writer / Make Me a Hanzi（Arphic Public License），https://github.com/chanind/hanzi-writer-data`)
  const buffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  const zip = await JSZip.loadAsync(buffer)
  const slideFile = zip.file('ppt/slides/slide1.xml')
  if (!slideFile) throw new Error('无法生成 PPT 页面')
  let xml = await slideFile.async('string')
  const names = new Map<string, number>()
  for (const match of xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"[^>]*\bname="([^"]+)"/g)) names.set(match[2], Number(match[1]))
  const ids = segments.map(segment => names.get(escapeXml(shapeName(character, segment))) ?? 0)
  const timing = buildTiming(segments, ids, gap, speed, style)
  xml = xml.replace('</p:sld>', `${timing}</p:sld>`)
  zip.file('ppt/slides/slide1.xml', xml)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
