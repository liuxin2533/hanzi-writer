# PowerPoint Shape SVG Filename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every PowerPoint shape created by the generated VBS use the corresponding complete SVG filename, including the `.svg` extension.

**Architecture:** Keep the existing SVG export, sorting, import, and animation logic intact. Add one VBS assignment immediately after `Shapes.AddPicture`, and protect that placement with a small Node built-in regression test that inspects the actual VBS template in `src/app/page.tsx`.

**Tech Stack:** Next.js 16, TypeScript/TSX, VBScript template, Node.js built-in test runner

---

### Task 1: Add PowerPoint shape filename regression coverage

**Files:**
- Create: `tests/vbs-shape-naming.test.mjs`
- Modify: `package.json`

- [x] **Step 1: Write the failing test**

Create `tests/vbs-shape-naming.test.mjs`:

```js
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
```

Add the test command to `package.json`:

```json
{
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test
```

Expected: FAIL in `generated VBS names each PowerPoint shape after its complete SVG filename` because the assignment is absent.

### Task 2: Assign the SVG filename to the imported PowerPoint shape

**Files:**
- Modify: `src/app/page.tsx` in `buildIndividualVbs`, immediately after `Shapes.AddPicture`
- Test: `tests/vbs-shape-naming.test.mjs`

- [x] **Step 1: Write the minimal implementation**

Change the generated VBS block to:

```vbscript
    Set shape = objSlide.Shapes.AddPicture(fullPath, 0, -1, leftPos, topPos, size, size)
    shape.Name = arrFiles(i)

    If InStr(arrFiles(i), "_00.svg") > 0 Then
```

- [x] **Step 2: Run the focused test**

Run:

```bash
pnpm test
```

Expected: PASS with one passing test.

- [x] **Step 3: Run static and production checks**

Run:

```bash
pnpm lint
pnpm build
```

Expected: both commands exit successfully without errors.

Result: the production build and the new regression test's lint check pass. The full-project lint command still reports two pre-existing `react-hooks/set-state-in-effect` errors in `src/app/page.tsx:660` and `src/app/page.tsx:665`, outside this change.

- [x] **Step 4: Review the resulting diff**

Run:

```bash
git diff --check
git diff -- src/app/page.tsx package.json tests/vbs-shape-naming.test.mjs
```

Expected: no whitespace errors; the implementation diff only adds the test command, regression test, and the VBS shape-name assignment.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/app/page.tsx package.json tests/vbs-shape-naming.test.mjs docs/superpowers/plans/2026-07-30-ppt-shape-svg-filename.md
git commit -m "fix: match ppt shape names to svg files"
```
