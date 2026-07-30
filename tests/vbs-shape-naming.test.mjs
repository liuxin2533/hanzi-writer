import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(
  new URL('../src/app/page.tsx', import.meta.url),
  'utf8',
)

test('generated VBS names each PowerPoint shape after its complete SVG filename', () => {
  assert.match(
    pageSource,
    /Set shape = objSlide\.Shapes\.AddPicture\([^\r\n]+\)\r?\n\s+shape\.Name = arrFiles\(i\)/,
  )
})
