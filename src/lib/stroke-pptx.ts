import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { animationTimeline, boundsOf } from './stroke-split.ts'
import type { Segment, StrokeModel } from './stroke-split.ts'
import type { MultiPolygon } from 'polygon-clipping'

export type DrawingStyle = {
  grid: boolean; ghost: boolean; gridBorderColor: string; gridBorderWidth: number
  gridDashedColor: string; gridDashedWidth: number; ghostColor: string; strokeColor: string
}
export const DEFAULT_STYLE: DrawingStyle = {
  grid: true, ghost: true, gridBorderColor: '#8b7355', gridBorderWidth: 4,
  gridDashedColor: '#8b7355', gridDashedWidth: 2, ghostColor: '#d4c5b0', strokeColor: '#1a1a1a',
}
const color = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '1a1a1a'
const shapeName = (segment: Segment) => `hanzi-stroke-${segment.stroke + 1}-part-${segment.part + 1}`

// Mirrors PowerPoint's automatic, after-previous entrance sequence.
// OOXML's wipe filter names the origin edge: wipe(up) reveals from top to bottom.
// Verified against PowerPoint's rendered frames, not just the animation enum names.
export function buildTiming(segments: Segment[], shapeIds: number[], gap: number, speed: number): string {
  if (shapeIds.length !== segments.length || shapeIds.some(id => !Number.isInteger(id) || id < 1)) throw new Error('PPT 动画对象匹配失败')
  let node = 4
  const subtype = { down: 1, left: 2, up: 4, right: 8 }
  const filter = { down: 'up', left: 'right', up: 'down', right: 'left' }
  const effects = animationTimeline(segments, gap, speed).map(({ segment, start, duration, delay }, index) => {
    const ids = [node++, node++, node++, node++]
    const target = `<p:tgtEl><p:spTgt spid="${shapeIds[index]}"/></p:tgtEl>`
    return `<p:par><p:cTn id="${ids[0]}" fill="hold"><p:stCondLst><p:cond delay="${start - delay}"/></p:stCondLst><p:childTnLst>
      <p:par><p:cTn id="${ids[1]}" presetID="22" presetClass="entr" presetSubtype="${subtype[segment.direction]}" fill="hold" grpId="0" nodeType="afterEffect">
      <p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>
      <p:set><p:cBhvr><p:cTn id="${ids[2]}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${target}
      <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
      <p:animEffect transition="in" filter="wipe(${filter[segment.direction]})"><p:cBhvr><p:cTn id="${ids[3]}" dur="${duration}"/>${target}</p:cBhvr></p:animEffect>
      </p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
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
  const addGeometry = (geometry: MultiPolygon, fill: string, objectName: string) => {
    const bounds = boundsOf(geometry)
    const points: NonNullable<PptxGenJS.ShapeProps['points']> = geometry.flatMap(polygon => polygon.flatMap(ring => [
      ...ring.slice(0, -1).map((p, i) => ({ x: (p[0] - bounds.x) * scale, y: (p[1] - bounds.y) * scale, moveTo: i === 0 })),
      { close: true as const },
    ]))
    // PptxGenJS 4 supports custGeom at runtime, but omits it from its ShapeType enum.
    slide.addShape('custGeom' as PptxGenJS.ShapeType, {
      x: x + bounds.x * scale, y: y + bounds.y * scale,
      w: bounds.width * scale, h: bounds.height * scale, points,
      // A subpixel outline hides antialiasing seams where two independent shapes meet.
      fill: { color: color(fill) }, line: { color: color(fill), width: 0.15 }, objectName,
    })
  }
  if (style.grid) {
    slide.addShape(pptx.ShapeType.rect, { x, y, w: size, h: size,
      line: { color: color(style.gridBorderColor), width: style.gridBorderWidth * 4 * scale * 72 }, objectName: '田字格外框' })
    for (const [ax, ay, bx, by] of [[0, 512, 1024, 512], [512, 0, 512, 1024], [0, 0, 1024, 1024], [0, 1024, 1024, 0]]) {
      slide.addShape(pptx.ShapeType.line, { x: x + ax * scale, y: y + Math.min(ay, by) * scale,
        w: (bx - ax) * scale, h: Math.abs(by - ay) * scale, flipV: by < ay,
        line: { color: color(style.gridDashedColor), width: style.gridDashedWidth * 4 * scale * 72, transparency: 40, dashType: 'dash' }, objectName: '田字格虚线' })
    }
  }
  if (style.ghost) models.forEach((model, i) => addGeometry(model.outline, style.ghostColor, `底字-${i + 1}`))
  segments.forEach(segment => addGeometry(segment.geometry, style.strokeColor, shapeName(segment)))
  slide.addNotes(`汉字：${character}\n原笔画：${models.length}，动画片段：${segments.length}。进入放映后自动书写。\n字形来源：Hanzi Writer / Make Me a Hanzi（Arphic Public License），https://github.com/chanind/hanzi-writer-data`)
  const buffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  const zip = await JSZip.loadAsync(buffer)
  const slideFile = zip.file('ppt/slides/slide1.xml')
  if (!slideFile) throw new Error('无法生成 PPT 页面')
  let xml = await slideFile.async('string')
  const names = new Map<string, number>()
  for (const match of xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"[^>]*\bname="([^"]+)"/g)) names.set(match[2], Number(match[1]))
  const ids = segments.map(segment => names.get(shapeName(segment)) ?? 0)
  const timing = buildTiming(segments, ids, gap, speed)
  xml = xml.replace('</p:sld>', `${timing}</p:sld>`)
  zip.file('ppt/slides/slide1.xml', xml)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
