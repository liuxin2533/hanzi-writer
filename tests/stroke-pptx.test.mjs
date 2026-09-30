import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'
import { analyzeCharacter, animationTimeline, defaultSettings, splitStroke } from '../src/lib/stroke-split.ts'
import { createStrokePptx, DEFAULT_STYLE } from '../src/lib/stroke-pptx.ts'

async function exportHao(t, { grid = true, ghost = true, gap = 180, speed = 1 } = {}) {
  const data = JSON.parse(readFileSync(new URL('./fixtures/号.json', import.meta.url), 'utf8'))
  const models = analyzeCharacter(data)
  const segments = models.flatMap((model, i) => splitStroke(model, defaultSettings(model), i))
  const style = { ...DEFAULT_STYLE, grid, ghost, strokeColor: '#123456', currentStrokeColor: '#AB2345', ghostColor: '#CDEFAB', gridBorderColor: '#12ABCD', gridDashedColor: '#987654' }
  const zip = await JSZip.loadAsync(await createStrokePptx('号', models, segments, style, gap, speed))
  const dom = new JSDOM(await zip.file('ppt/slides/slide1.xml').async('string'), { contentType: 'text/xml' })
  t.after(() => dom.window.close())
  const doc = dom.window.document
  const nodes = name => [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', name)]
  return { doc, nodes, models, segments, style, zip }
}

async function backgroundSvg(t, nodes, zip) {
  const picture = nodes('pic')[0]
  const svgId = picture.getElementsByTagName('asvg:svgBlip')[0].getAttribute('r:embed')
  const rels = new JSDOM(await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string'), { contentType: 'text/xml' })
  t.after(() => rels.window.close())
  const relation = [...rels.window.document.getElementsByTagName('Relationship')].find(n => n.getAttribute('Id') === svgId)
  const svgPath = relation.getAttribute('Target').replace('../', 'ppt/')
  const svg = new JSDOM(await zip.file(svgPath).async('string'), { contentType: 'image/svg+xml' })
  t.after(() => svg.window.close())
  return svg.window.document
}

test('号: grid and ghost are a single SVG picture, without a group or child shapes', async t => {
  const { nodes, segments, models, zip } = await exportHao(t)
  const objects = [...nodes('spTree')[0].children].filter(n => ['sp', 'grpSp', 'pic'].includes(n.localName))
  assert.equal(objects.length, segments.length + 1)
  assert.equal(objects[0].getElementsByTagName('p:cNvPr')[0].getAttribute('name'), '号-0')
  assert.equal(objects[0].localName, 'pic')
  assert.equal(nodes('grpSp').length, 0, 'no expandable groups anywhere in the slide')
  assert.equal(nodes('sp').length, segments.length, 'only animated parts remain as shapes')
  assert.equal(nodes('pic').length, 1)
  const svg = await backgroundSvg(t, nodes, zip)
  assert.equal(svg.querySelector('rect').getAttribute('stroke').toUpperCase(), '#12ABCD')
  assert.equal(svg.querySelector('path[stroke-dasharray]').getAttribute('stroke').toUpperCase(), '#987654')
  assert.equal(svg.querySelectorAll('path[fill="#CDEFAB"]').length, models.length)
  const ids = nodes('cNvPr').map(n => n.getAttribute('id'))
  assert.equal(new Set(ids).size, ids.length, 'image and shape IDs stay unique')
})

test('号: object names use the character, stroke number and part number', async t => {
  const { nodes, segments } = await exportHao(t)
  const names = new Map(nodes('cNvPr').map(n => [n.getAttribute('id'), n.getAttribute('name')]))
  const effects = nodes('animEffect')
  effects.forEach((effect, i) => {
    const target = effect.getElementsByTagName('p:spTgt')[0].getAttribute('spid')
    assert.equal(names.get(target), `号-${segments[i].stroke + 1}-part-${segments[i].part + 1}`)
  })
})

test('all stroke parts and the background share a canvas when resized individually together', async t => {
  const { nodes, segments } = await exportHao(t)
  const objects = [...nodes('spTree')[0].children].filter(n => ['sp', 'pic'].includes(n.localName))
  const transforms = objects.map(object => {
    const transform = object.getElementsByTagName('a:xfrm')[0]
    const offset = transform.getElementsByTagName('a:off')[0]
    const size = transform.getElementsByTagName('a:ext')[0]
    return ['x', 'y'].map(a => Number(offset.getAttribute(a))).concat(['cx', 'cy'].map(a => Number(size.getAttribute(a))))
  })
  assert.equal(transforms.length, segments.length + 1)
  for (const transform of transforms) assert.deepEqual(transform, transforms[0], 'every object must have identical left, top, width and height')
  // Setting the same smaller/larger square size on every selected object must
  // preserve each path's position inside the background canvas.
  const svgPadding = 4
  const canvasUnits = 1024 + svgPadding * 2
  for (const factor of [0.5, 1.5]) {
    nodes('sp').forEach((shape, i) => {
      const path = shape.getElementsByTagName('a:path')[0]
      const point = path.getElementsByTagName('a:pt')[0]
      const geometryPoint = segments[i].geometry[0][0][0]
      for (const [axis, attribute] of ['x', 'y'].entries()) {
        const actual = Number(point.getAttribute(attribute)) / Number(path.getAttribute(axis === 0 ? 'w' : 'h')) * transforms[0][axis + 2] * factor
        const expected = (geometryPoint[axis] + svgPadding) / canvasUnits * transforms[0][axis + 2] * factor
        assert.ok(Math.abs(actual - expected) < 2, `${attribute}: resized ink must stay aligned with its background`)
      }
    })
  }
})

test('号: before playback every animated part has the ghost fill and outline', async t => {
  const { nodes } = await exportHao(t)
  const shapes = new Map(nodes('sp').map(n => [n.getElementsByTagName('p:cNvPr')[0].getAttribute('id'), n]))
  nodes('animEffect').forEach(effect => {
    const target = effect.getElementsByTagName('p:spTgt')[0].getAttribute('spid')
    const fills = [...shapes.get(target).getElementsByTagName('a:solidFill')].map(n => n.firstElementChild.getAttribute('val'))
    assert.deepEqual(fills, ['CDEFAB', 'CDEFAB'])
  })
})

test('号: only the playing stroke is highlighted; every whole stroke completes in the regular color', async t => {
  const gap = 350, speed = 2
  const { nodes, segments } = await exportHao(t, { gap, speed })
  const effects = nodes('animEffect')
  const colorChanges = nodes('animClr')
  const timeline = animationTimeline(segments, gap, speed)
  const startsAt = behavior => {
    let start = 0
    for (let n = behavior.parentElement; n; n = n.parentElement) {
      if (n.localName !== 'cTn') continue
      const conditions = [...n.children].find(child => child.localName === 'stCondLst')
      const delay = Number(conditions?.firstElementChild?.getAttribute('delay'))
      if (Number.isFinite(delay)) start += delay
    }
    return start
  }
  effects.forEach((effect, i) => {
    const target = effect.getElementsByTagName('p:spTgt')[0].getAttribute('spid')
    const completedStroke = timeline.findLast(entry => entry.segment.stroke === segments[i].stroke)
    const expected = [{ time: timeline[i].start, to: 'AB2345' }, { time: completedStroke.end, to: '123456' }]
    for (const attribute of ['fillcolor', 'stroke.color']) {
      const changes = colorChanges.filter(n => n.getElementsByTagName('p:spTgt')[0].getAttribute('spid') === target &&
        n.getElementsByTagName('p:attrName')[0].textContent === attribute)
        .map(n => ({ time: startsAt(n), to: n.getElementsByTagName('a:srgbClr')[0].getAttribute('val') }))
      assert.deepEqual(changes, expected, `${target} ${attribute}: reset all parts when the whole stroke ends, including the final stroke`)
    }
  })
})

test('the single background picture follows the grid and ghost switches', async t => {
  for (const [grid, ghost] of [[true, false], [false, true], [false, false]]) {
    const { nodes, models, segments, zip } = await exportHao(t, { grid, ghost })
    assert.equal(nodes('grpSp').length, 0)
    assert.equal(nodes('pic').length, grid || ghost ? 1 : 0)
    assert.equal(nodes('sp').length, segments.length)
    if (grid || ghost) {
      const svg = await backgroundSvg(t, nodes, zip)
      assert.equal(svg.querySelectorAll('rect').length, grid ? 1 : 0)
      assert.equal(svg.querySelectorAll('path[stroke-dasharray]').length, grid ? 1 : 0)
      assert.equal(svg.querySelectorAll('path[fill="#CDEFAB"]').length, ghost ? models.length : 0)
    }
    assert.equal(nodes('animEffect').length, segments.length)
  }
})

for (const character of ['弯', '心', '呼', '呀']) {
  test(`${character}: exported PPTX has one slide, editable pieces, valid XML and automatic wipe targets`, async () => {
    const data = JSON.parse(readFileSync(new URL(`./fixtures/${character}.json`, import.meta.url), 'utf8'))
    const models = analyzeCharacter(data)
    const segments = models.flatMap((model, i) => splitStroke(model, defaultSettings(model), i))
    const buffer = await createStrokePptx(character, models, segments, DEFAULT_STYLE, 350, 2)
    const zip = await JSZip.loadAsync(buffer)
    assert.equal(Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length, 1)
    for (const filename of Object.keys(zip.files).filter(f => f.endsWith('.xml') || f.endsWith('.rels'))) {
      const dom = new JSDOM(await zip.file(filename).async('string'), { contentType: 'text/xml' })
      assert.equal(dom.window.document.getElementsByTagName('parsererror').length, 0, filename)
      dom.window.close()
    }
    const dom = new JSDOM(await zip.file('ppt/slides/slide1.xml').async('string'), { contentType: 'text/xml' })
    const doc = dom.window.document
    const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'
    const nodes = name => [...doc.getElementsByTagNameNS(p, name)]
    const effects = nodes('animEffect')
    assert.equal(effects.length, segments.length)
    const shapes = new Map(nodes('cNvPr').map(n => [n.getAttribute('id'), n.getAttribute('name')]))
    if (character === '弯') {
      assert.deepEqual([...shapes.values()].filter(name => name.startsWith('弯-1-part-')), ['弯-1-part-1'])
      assert.equal(effects[0].getAttribute('filter'), 'wipe(up)', 'the whole first dot wipes from the top edge')
    }
    effects.forEach((effect, i) => {
      const originEdge = { down: 'up', up: 'down', right: 'left', left: 'right' }
      assert.equal(effect.getAttribute('filter'), `wipe(${originEdge[segments[i].direction]})`)
      assert.equal(effect.getAttribute('transition'), 'in')
      const target = effect.getElementsByTagNameNS(p, 'spTgt')[0].getAttribute('spid')
      assert.equal(shapes.get(target), `${character}-${segments[i].stroke + 1}-part-${segments[i].part + 1}`)
      assert.equal(Number(effect.getElementsByTagNameNS(p, 'cTn')[0].getAttribute('dur')), Math.round(segments[i].duration / 2))
    })
    const ids = nodes('cTn').map(n => n.getAttribute('id'))
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(nodes('cTn').filter(n => n.getAttribute('nodeType') === 'afterEffect').length, segments.length)
    assert.ok(nodes('cond').some(n => n.getAttribute('evt') === 'onBegin'), 'automatic start on slide entry')
    assert.equal(nodes('cond').filter(n => n.getAttribute('evt') === 'onClick').length, 0)
    assert.equal(nodes('grpSp').length, 0)
    assert.equal(nodes('pic').length, 1)
    assert.equal(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'custGeom').length, segments.length)
    if (character === '呼' || character === '呀') {
      assert.equal(segments.length, 11)
      assert.equal(nodes('cNvPr').length - 1, 12, '11 animated parts plus one indivisible background')
    }
    dom.window.close()
  })
}

test('disabling grid and ghost leaves only the animated stroke objects', async () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/口.json', import.meta.url), 'utf8'))
  const models = analyzeCharacter(data)
  const segments = models.flatMap((model, i) => splitStroke(model, defaultSettings(model), i))
  const zip = await JSZip.loadAsync(await createStrokePptx('口', models, segments, { ...DEFAULT_STYLE, grid: false, ghost: false }))
  const xml = await zip.file('ppt/slides/slide1.xml').async('string')
  assert.equal((xml.match(/<p:sp>/g) ?? []).length, segments.length)
  assert.ok(!xml.includes('<p:pic>'), 'no raster images')
})
