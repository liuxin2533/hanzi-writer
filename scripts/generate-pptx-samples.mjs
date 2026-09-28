import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { analyzeCharacter, defaultSettings, splitStroke } from '../src/lib/stroke-split.ts'
import { createStrokePptx, DEFAULT_STYLE } from '../src/lib/stroke-pptx.ts'

mkdirSync('.local/pptx-samples', { recursive: true })
for (const character of ['口', '弯', '乙', '心', '永', '笔', '号']) {
  const data = JSON.parse(readFileSync(new URL(`../tests/fixtures/${character}.json`, import.meta.url), 'utf8'))
  const models = analyzeCharacter(data)
  const segments = models.flatMap((model, i) => splitStroke(model, defaultSettings(model), i))
  writeFileSync(`.local/pptx-samples/${character}.pptx`, Buffer.from(await createStrokePptx(character, models, segments, DEFAULT_STYLE)))
  writeFileSync(`.local/pptx-samples/${character}.json`, JSON.stringify(segments.map(s => ({ stroke: s.stroke + 1, part: s.part + 1, direction: s.direction, duration: s.duration })), null, 2))
  console.log(`${character}: ${models.length} strokes, ${segments.length} animated segments`)
}
