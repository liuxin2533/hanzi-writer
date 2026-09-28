'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { analyzeCharacter, animationTimeline, defaultSettings, DIRECTIONS, geometryPath, MIN_CUT_GAP, pointAt, splitStroke, validSettings } from '@/lib/stroke-split'
import type { CharacterData, Direction, StrokeModel, StrokeSettings } from '@/lib/stroke-split'
import type { DrawingStyle } from '@/lib/stroke-pptx'

const COLORS = ['#b73542', '#2d6a55', '#bd851c', '#386b9c', '#8a5688', '#855a35']
const storageKey = (character: string) => `hanzi-ppt-v1:${character}`
function signature(data: CharacterData) {
  let hash = 2166136261
  for (const char of JSON.stringify(data)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return String(hash >>> 0)
}

export default function StrokePptxPanel({ character, data, style, downloadTarget }: { character: string; data: CharacterData; style: DrawingStyle; downloadTarget: HTMLElement | null }) {
  const analysis = useMemo(() => {
    try { return { models: analyzeCharacter(data), error: '' } }
    catch (error) { return { models: [], error: error instanceof Error ? error.message : '笔画分析失败' } }
  }, [data])
  return analysis.error ? <section className="ppt-panel"><h2>笔顺动画 PPT</h2><p role="alert">{analysis.error}</p>
    {downloadTarget && createPortal(<button type="button" disabled title={analysis.error} className="px-4 py-2 bg-cinnabar text-white text-sm rounded-lg opacity-50">下载PPT</button>, downloadTarget)}</section> :
    <Editor key={`${character}-${signature(data)}`} character={character} models={analysis.models} fingerprint={signature(data)} style={style} downloadTarget={downloadTarget} />
}

function Editor({ character, models, fingerprint, style, downloadTarget }: { character: string; models: StrokeModel[]; fingerprint: string; style: DrawingStyle; downloadTarget: HTMLElement | null }) {
  const [initial] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(character)) ?? 'null')
      if (saved?.fingerprint === fingerprint && validSettings(saved.settings, models.length)) return { settings: saved.settings, restored: true }
    } catch { /* Storage is optional (private browsing / disabled storage). */ }
    return { settings: models.map(model => defaultSettings(model)), restored: false }
  })
  const [settings, setSettings] = useState<StrokeSettings[]>(initial.settings)
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [gap, setGap] = useState(180)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [scope, setScope] = useState<'all' | 'stroke'>('all')
  const [busy, setBusy] = useState(false)
  const exportingRef = useRef(false)
  const [message, setMessage] = useState(initial.restored ? '已载入这个字的已保存调整。如需重新自动拆分，可在“调整分段”中恢复整字。' : '')
  const [exportError, setExportError] = useState('')
  const dragging = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const clipPrefix = useId().replace(/:/g, '')
  const result = useMemo(() => {
    try { return { segments: models.flatMap((model, i) => splitStroke(model, settings[i], i)), error: '' } }
    catch (error) { return { segments: [], error: error instanceof Error ? error.message : '拆分失败，请调整切点' } }
  }, [models, settings])
  const parts = result.segments.filter(s => s.stroke === selected)
  const timeline = useMemo(() => animationTimeline(result.segments.filter(s => scope === 'all' || s.stroke === selected), gap, speed), [result.segments, selected, scope, gap, speed])
  const totalTime = timeline.at(-1)?.end ?? 0
  const allTime = animationTimeline(result.segments, gap, speed).at(-1)?.end ?? 0
  const activeStroke = elapsed === null ? undefined : timeline.find(entry => entry.start <= elapsed && elapsed < entry.end)?.segment.stroke
  const showSegments = editing && elapsed === null

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const time = Math.min(now - start, totalTime)
      setElapsed(time)
      if (time < totalTime) frame = requestAnimationFrame(tick)
      else setPlaying(false)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, totalTime, timeline])

  const stop = () => { setPlaying(false); setElapsed(null) }
  const update = (next: StrokeSettings) => {
    stop()
    setSettings(previous => previous.map((value, i) => i === selected ? next : value))
    setMessage('调整尚未保存')
    setExportError('')
  }
  const updateCuts = (cuts: number[]) => update(defaultSettings(models[selected], cuts))
  const resetAll = () => {
    stop()
    setSettings(models.map(model => defaultSettings(model)))
    setMessage('已恢复整字自动拆分，可保存这个字的调整')
    setExportError('')
  }
  const moveCut = (index: number, value: number) => {
    const cuts = [...settings[selected].cuts]
    cuts[index] = Math.max((cuts[index - 1] ?? 0) + MIN_CUT_GAP, Math.min((cuts[index + 1] ?? 1) - MIN_CUT_GAP, value))
    // Moving a boundary keeps the user's direction and duration choices.
    update({ ...settings[selected], cuts })
  }
  const addCut = () => {
    const stops = [0, ...settings[selected].cuts, 1]
    let widest = 0
    for (let i = 1; i < stops.length - 1; i++) if (stops[i + 1] - stops[i] > stops[widest + 1] - stops[widest]) widest = i
    if (stops[widest + 1] - stops[widest] < MIN_CUT_GAP * 2) return
    updateCuts([...settings[selected].cuts, (stops[widest] + stops[widest + 1]) / 2].sort((a, b) => a - b))
  }
  const play = (nextScope: 'all' | 'stroke') => {
    setScope(nextScope)
    setElapsed(0)
    setPlaying(true)
  }
  const save = () => {
    try {
      localStorage.setItem(storageKey(character), JSON.stringify({ fingerprint, settings }))
      setMessage('已保存在当前浏览器，下次使用这个字会自动载入')
    } catch { setMessage('浏览器无法保存设置；仍可预览和下载 PPT') }
  }
  const download = async () => {
    if (result.error || exportingRef.current) return
    exportingRef.current = true
    setBusy(true)
    setExportError('')
    try {
      const { createStrokePptx } = await import('@/lib/stroke-pptx')
      const buffer = await createStrokePptx(character, models, result.segments, style, gap, speed)
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${character}_笔顺动画.pptx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      setMessage('PPT 已生成。打开文件后进入幻灯片放映，即可自动书写。')
    } catch (error) { setExportError(error instanceof Error ? error.message : '导出失败，请重试') }
    finally { exportingRef.current = false; setBusy(false) }
  }

  return <section className="ppt-panel" aria-labelledby="ppt-heading">
    {/* Both buttons use the live editor state, including unsaved adjustments. */}
    {downloadTarget && createPortal(<>
      <button type="button" onClick={download} disabled={busy || !!result.error} aria-busy={busy} title={result.error || undefined}
        className="px-4 py-2 bg-cinnabar text-white text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">{busy ? '正在生成…' : '下载PPT'}</button>
      {exportError && <span role="alert" className="text-sm text-cinnabar">{exportError}</span>}
    </>, downloadTarget)}
    <div className="ppt-heading">
      <div><h2 id="ppt-heading">一字一页，落笔有序</h2><p>自动拆分转弯，下载带擦除动画的 PowerPoint。</p></div>
      <button className="ppt-primary" onClick={download} disabled={busy || !!result.error}>{busy ? '正在生成…' : '↓ 下载笔顺 PPT'}</button>
    </div>
    <div className="ppt-summary"><span><b>{models.length}</b> 笔</span><span><b>{result.segments.length}</b> 个动画片段</span><span>约 <b>{(allTime / 1000).toFixed(1)}</b> 秒</span><span className="ppt-summary-note">单页 · 矢量 · 自动播放</span></div>
    <div className="ppt-workspace">
      <div className="ppt-preview-column">
        <div className="ppt-preview">
          <svg ref={svgRef} viewBox="0 0 1024 1024" role="img" aria-label={`${character}的${showSegments ? '分段' : elapsed === null ? '底字' : '擦除动画'}预览`}
            onPointerMove={event => {
              if (dragging.current === null || !svgRef.current) return
              const rect = svgRef.current.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width * 1024, y = (event.clientY - rect.top) / rect.height * 1024
              let best = 0, nearest = Infinity
              for (let i = 0; i <= 200; i++) {
                const p = pointAt(models[selected].median, i / 200), d = Math.hypot(x - p[0], y - p[1])
                if (d < nearest) { nearest = d; best = i / 200 }
              }
              moveCut(dragging.current, best)
            }} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
            {style.grid && <g fill="none"><rect x="8" y="8" width="1008" height="1008" stroke={style.gridBorderColor} strokeWidth={style.gridBorderWidth * 4} />
              <path d="M0 512H1024M512 0V1024M0 0L1024 1024M1024 0L0 1024" stroke={style.gridDashedColor} strokeWidth={style.gridDashedWidth * 4} opacity="0.6" strokeDasharray="32 24" /></g>}
            {(style.ghost || showSegments || scope === 'stroke') && models.map((model, i) => <path key={i} d={geometryPath(model.outline)} fill={showSegments && i !== selected ? '#ded9cd' : style.ghostColor} opacity={showSegments && i !== selected ? 0.65 : 1} />)}
            {showSegments && parts.map((part, i) => <path key={i} d={part.path} fill={COLORS[i % COLORS.length]} />)}
            {elapsed !== null && timeline.map(({ segment, start, duration }, i) => {
              const progress = Math.max(0, Math.min(1, (elapsed - start) / duration)), b = segment.bounds
              const horizontal = segment.direction === 'left' || segment.direction === 'right'
              const width = horizontal ? b.width * progress : b.width, height = horizontal ? b.height : b.height * progress
              const x = b.x + (segment.direction === 'left' ? b.width - width : 0), y = b.y + (segment.direction === 'up' ? b.height - height : 0)
              const fill = segment.stroke === activeStroke ? style.currentStrokeColor : style.strokeColor
              return <g key={i}><defs><clipPath id={`${clipPrefix}-${i}`}><rect x={x} y={y} width={width} height={height} /></clipPath></defs><path d={segment.path} fill={fill} stroke={fill} strokeWidth="0.4" clipPath={`url(#${clipPrefix}-${i})`} /></g>
            })}
            {editing && elapsed === null && <g><polyline points={models[selected].median.map(p => p.join(',')).join(' ')} fill="none" stroke="#fff" strokeWidth="5" strokeDasharray="10 10" />
              {settings[selected].cuts.map((cut, i) => {
                const p = pointAt(models[selected].median, cut)
                return <g key={i} className="ppt-cut-handle" onPointerDown={event => {
                  event.preventDefault(); dragging.current = i; event.currentTarget.setPointerCapture(event.pointerId)
                }}><circle cx={p[0]} cy={p[1]} r="25" fill="#fffdf7" stroke="#b73542" strokeWidth="5" /><text x={p[0]} y={p[1] + 10} textAnchor="middle" fontSize="30" fill="#b73542">{i + 1}</text></g>
              })}</g>}
          </svg>
        </div>
        <div className="ppt-preview-caption">{showSegments ? `第 ${selected + 1} 笔 · ${parts.length} 段以不同颜色标示` : elapsed === null ? '未播放 · 底字预览' : `${scope === 'all' ? '整字' : '当前笔'}擦除预览 · ${(elapsed / 1000).toFixed(1)} / ${(totalTime / 1000).toFixed(1)} 秒`}</div>
        <div className="ppt-actions"><button onClick={() => play('all')} disabled={playing || !!result.error}>▶ 预览整字</button><button onClick={stop} disabled={elapsed === null}>↺ 重置预览</button></div>
      </div>
      <div className="ppt-controls">
        <div className="ppt-control-title"><h3>笔画与片段</h3><button className="ppt-text-button" onClick={() => { stop(); setEditing(!editing) }}>{editing ? '收起调整' : '调整分段'}</button></div>
        <div className="ppt-stroke-list" aria-label="选择笔画">{models.map((model, i) => <button key={i} aria-label={`第 ${i + 1} 笔`} aria-pressed={selected === i} onClick={() => { stop(); setSelected(i) }} className={selected === i ? 'active' : ''}>
          <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d={geometryPath(model.outline)} fill="currentColor" /></svg><span>{i + 1}</span>
        </button>)}</div>
        <div className="ppt-part-list">{parts.map((part, i) => <div className="ppt-part-row" key={i}>
          <span className="ppt-part-number" style={{ color: COLORS[i % COLORS.length] }}>● <span>{selected + 1}.{i + 1}</span></span>
          {editing ? <><select aria-label={`片段 ${i + 1} 擦除方向`} value={settings[selected].directions[i]} onChange={e => { const directions = [...settings[selected].directions]; directions[i] = e.target.value as Direction; update({ ...settings[selected], directions }) }}>
            {Object.entries(DIRECTIONS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
            <label className="ppt-duration"><input aria-label={`片段 ${i + 1} 时长（秒）`} type="number" min="0.1" max="10" step="0.05" value={settings[selected].durations[i] / 1000} onChange={e => {
              if (!e.target.value || !Number.isFinite(e.target.valueAsNumber)) return
              const durations = [...settings[selected].durations]; durations[i] = Math.max(100, Math.min(10000, Math.round(e.target.valueAsNumber * 1000))); update({ ...settings[selected], durations })
            }} />秒</label></> : <><span>{DIRECTIONS[part.direction]}</span><span className="ppt-part-time">{(part.duration / speed / 1000).toFixed(2)} 秒</span></>}
        </div>)}</div>
        {editing && <div className="ppt-cut-editor"><div className="ppt-control-title"><span>切分位置</span><button className="ppt-text-button" onClick={addCut} disabled={settings[selected].cuts.length >= 30}>＋ 添加切点</button></div>
          <p>拖动图中圆点或滑块调整。增删切点会重新计算本笔方向和时长。</p>
          {settings[selected].cuts.map((cut, i) => <div className="ppt-cut-row" key={i}><span>{i + 1}</span><input type="range" aria-label={`切点 ${i + 1} 位置`} min={((settings[selected].cuts[i - 1] ?? 0) + MIN_CUT_GAP) * 100} max={((settings[selected].cuts[i + 1] ?? 1) - MIN_CUT_GAP) * 100} step="0.1" value={cut * 100} onChange={e => moveCut(i, Number(e.target.value) / 100)} /><span>{Math.round(cut * 100)}%</span><button aria-label={`删除切点 ${i + 1}`} onClick={() => updateCuts(settings[selected].cuts.filter((_, j) => i !== j))}>×</button></div>)}
          <div className="ppt-actions"><button onClick={() => play('stroke')} disabled={playing || !!result.error}>▶ 预览本笔</button><button onClick={() => update(defaultSettings(models[selected]))}>恢复本笔自动拆分</button><button onClick={resetAll}>恢复整字自动拆分</button><button onClick={save} disabled={!!result.error}>保存这个字的调整</button></div>
        </div>}
        <div className="ppt-playback-settings"><label>播放速度<select value={speed} onChange={e => { stop(); setSpeed(Number(e.target.value)) }}><option value="0.5">0.5× 慢速</option><option value="1">1× 正常</option><option value="1.5">1.5×</option><option value="2">2× 快速</option></select></label>
          <label>笔间停顿<select value={gap} onChange={e => { stop(); setGap(Number(e.target.value)) }}><option value="0">不停顿</option><option value="180">0.18 秒</option><option value="350">0.35 秒</option><option value="600">0.6 秒</option></select></label></div>
        <p className="ppt-help">PPT 沿用上方的格线、底字和两种笔画色。未播放显示底字色，当前笔高亮，每笔完成后恢复常规色。曲线擦除为近似效果，复杂弯钩可先预览再调整。</p>
      </div>
    </div>
    {(result.error || exportError) && <p className="ppt-error" role="alert">{result.error || exportError}</p>}
    <p className="ppt-status" role="status">{message || '在浏览器中生成，无需安装脚本。建议使用桌面版 PowerPoint 放映。'}</p>
  </section>
}
