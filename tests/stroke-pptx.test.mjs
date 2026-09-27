import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'
import { analyzeCharacter, defaultSettings, splitStroke } from '../src/lib/stroke-split.ts'
import { createStrokePptx, DEFAULT_STYLE } from '../src/lib/stroke-pptx.ts'

for (const character of ['弯', '心']) {
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
      assert.deepEqual([...shapes.values()].filter(name => name.startsWith('hanzi-stroke-1-part-')), ['hanzi-stroke-1-part-1'])
      assert.equal(effects[0].getAttribute('filter'), 'wipe(up)', 'the whole first dot wipes from the top edge')
    }
    effects.forEach((effect, i) => {
      const originEdge = { down: 'up', up: 'down', right: 'left', left: 'right' }
      assert.equal(effect.getAttribute('filter'), `wipe(${originEdge[segments[i].direction]})`)
      assert.equal(effect.getAttribute('transition'), 'in')
      const target = effect.getElementsByTagNameNS(p, 'spTgt')[0].getAttribute('spid')
      assert.equal(shapes.get(target), `hanzi-stroke-${segments[i].stroke + 1}-part-${segments[i].part + 1}`)
      assert.equal(Number(effect.getElementsByTagNameNS(p, 'cTn')[0].getAttribute('dur')), Math.round(segments[i].duration / 2))
    })
    const ids = nodes('cTn').map(n => n.getAttribute('id'))
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(nodes('cTn').filter(n => n.getAttribute('nodeType') === 'afterEffect').length, segments.length)
    assert.ok(nodes('cond').some(n => n.getAttribute('evt') === 'onBegin'), 'automatic start on slide entry')
    assert.equal(nodes('cond').filter(n => n.getAttribute('evt') === 'onClick').length, 0)
    assert.equal(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'custGeom').length, models.length + segments.length)
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
