import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import clipping from 'polygon-clipping'
import { analyzeCharacter, defaultSettings, splitStroke, geometryArea, flattenOutline, validSettings, animationTimeline } from '../src/lib/stroke-split.ts'

export const fixture = character => JSON.parse(readFileSync(new URL(`./fixtures/${character}.json`, import.meta.url), 'utf8'))

for (const character of ['口', '弯', '乙', '心', '永', '笔']) {
  test(`${character}: split pieces cover the original without overlapping and retain stroke order`, () => {
    const models = analyzeCharacter(fixture(character))
    const segments = models.flatMap((model, stroke) => {
      const parts = splitStroke(model, defaultSettings(model), stroke)
      assert.ok(parts.every(p => p.stroke === stroke && p.bounds.width > 0 && p.bounds.height > 0))
      const combined = clipping.union(...parts.map(p => p.geometry))
      assert.ok(geometryArea(clipping.xor(combined, model.outline)) < 0.01, 'missing or extra area')
      assert.ok(Math.abs(parts.reduce((sum, p) => sum + geometryArea(p.geometry), 0) - geometryArea(model.outline)) < 0.01, 'overlap')
      return parts
    })
    const timeline = animationTimeline(segments, 180)
    timeline.forEach((entry, i) => {
      if (i) assert.equal(entry.start - timeline[i - 1].end, entry.segment.stroke === segments[i - 1].stroke ? 0 : 180)
    })
  })
}

test('口 horizontal turn and 弯 final stroke have the expected writing directions', () => {
  const mouth = analyzeCharacter(fixture('口'))
  assert.deepEqual(defaultSettings(mouth[1]).directions, ['right', 'down'])
  const bend = analyzeCharacter(fixture('弯'))
  assert.deepEqual(defaultSettings(bend.at(-1)).directions, ['down', 'right', 'down', 'left'])
})

test('manual cuts, directions and timing work; malformed saved settings are rejected', () => {
  const model = analyzeCharacter(fixture('口'))[0]
  const settings = defaultSettings(model, [0.45])
  settings.directions[0] = 'up'
  settings.durations[0] = 800
  const parts = splitStroke(model, settings)
  assert.equal(parts[0].direction, 'up')
  assert.equal(parts[0].duration, 800)
  assert.equal(parts.length, 2)
  for (const value of [null, [{ ...settings, cuts: [0.9, 0.1] }], [{ ...settings, directions: ['bad', 'down'] }], [{ ...settings, durations: [NaN, 1] }]]) {
    assert.equal(validSettings(value, 1), false)
  }
  assert.throws(() => analyzeCharacter({ strokes: ['M0 0L1 0L1 1Z'], medians: [] }), /轨迹/)
})

test('flattening preserves nonzero holes and converts coordinates consistently', () => {
  const outline = flattenOutline('M0 0H100V100H0Z M25 25V75H75V25Z')
  assert.equal(geometryArea(outline), 7500)
})

if (process.env.WRITE_SPLIT_PREVIEW) {
  mkdirSync('.local', { recursive: true })
  const colors = ['#c41e3a', '#2d5a45', '#c28a20', '#336fa3', '#975993']
  const models = analyzeCharacter(fixture('弯'))
  const parts = models.flatMap((model, stroke) => splitStroke(model, defaultSettings(model), stroke))
  writeFileSync('.local/bend-split.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${parts.map(p => `<path d="${p.path}" fill="${colors[p.part % colors.length]}"/>`).join('')}</svg>`)
}
