import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import clipping from 'polygon-clipping'
import { analyzeCharacter, defaultSettings, detectCuts, splitStroke, geometryArea, flattenOutline, validSettings, animationTimeline } from '../src/lib/stroke-split.ts'

export const fixture = character => JSON.parse(readFileSync(new URL(`./fixtures/${character}.json`, import.meta.url), 'utf8'))

test('弯 first dot stays whole and wipes from top to bottom', () => {
  const data = fixture('弯')
  const [dot] = analyzeCharacter({ strokes: [data.strokes[0]], medians: [data.medians[0]] })
  const parts = splitStroke(dot, defaultSettings(dot))
  assert.equal(parts.length, 1, 'a gently curving dot does not need a cut')
  assert.equal(parts[0].direction, 'down')
})

test('ordinary dots and falling strokes stay whole across different characters', () => {
  for (const [character, strokes] of [['弯', [0, 4, 5]], ['心', [0, 2, 3]], ['永', [0, 4]], ['笔', [0, 2, 3, 5]]]) {
    const models = analyzeCharacter(fixture(character))
    for (const stroke of strokes) {
      const parts = splitStroke(models[stroke], defaultSettings(models[stroke]), stroke)
      assert.deepEqual(parts.map(p => p.direction), ['down'], `${character} stroke ${stroke + 1}`)
    }
  }
})

test('gentle diagonal bends stay whole at different sizes; real corners still split', () => {
  for (const scale of [1, 2, 4]) {
    const dot = [[0, 0], [85, 40], [117, 76]].map(([x, y]) => [x * scale, y * scale])
    assert.deepEqual(detectCuts(dot), [])
  }
  for (const vertical of [-80, 80]) {
    assert.deepEqual(detectCuts([[0, 0], [80, 0], [80, vertical]]), [0.5])
  }
  assert.deepEqual(detectCuts([[0, 0], [80, 0], [80, 80], [0, 80]]), [1 / 3, 2 / 3])
})

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

test('curved hooks retain their changes of writing direction', () => {
  for (const [character, stroke, directions] of [
    ['心', 1, ['down', 'right', 'up']],
    ['乙', 0, ['right', 'down', 'right', 'up']],
    ['笔', 9, ['down', 'right', 'up']],
  ]) {
    const model = analyzeCharacter(fixture(character))[stroke]
    assert.deepEqual(defaultSettings(model).directions, directions, character)
  }
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
