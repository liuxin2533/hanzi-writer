'use client'

import { useState, useRef, useEffect } from 'react'
import HanziWriter from 'hanzi-writer'
import JSZip from 'jszip'

type AnimationState = 'idle' | 'playing' | 'paused' | 'complete'

export default function Home() {
  const [char, setChar] = useState('笔')
  const [inputChar, setInputChar] = useState('笔')
  const [state, setState] = useState<AnimationState>('idle')
  const [currentStroke, setCurrentStroke] = useState(0)
  const [totalStrokes, setTotalStrokes] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [isPaused, setIsPausedState] = useState(false)
  const [exportWithGrid, setExportWithGrid] = useState(true)
  const [exportWithGhost, setExportWithGhost] = useState(true)
  const [exportGridBorderColor, setExportGridBorderColor] = useState('#8b7355') // 默认外框颜色
  const [exportGridBorderWidth, setExportGridBorderWidth] = useState(4) // 默认外框粗细 (px)
  const [exportGridDashedColor, setExportGridDashedColor] = useState('#8b7355') // 默认内虚线颜色
  const [exportGridDashedWidth, setExportGridDashedWidth] = useState(2) // 默认内虚线粗细 (px)
  const [exportStrokeColor, setExportStrokeColor] = useState('#1a1a1a') // 默认常规笔划颜色
  const [exportCurrentStrokeColor, setExportCurrentStrokeColor] = useState('#c41e3a') // 默认当前笔划颜色 (朱砂红)
  const [exportGhostColor, setExportGhostColor] = useState('#d4c5b0') // 默认浅古沙色
  const [strokePaths, setStrokePaths] = useState<string[]>([])
  const STORAGE_KEY = 'hanzi_export_configs'
  const MAX_CONFIGS = 20
  // 挂载标记：避免 SSR 与客户端 localStorage 读取结果不一致导致 hydration 不匹配
  const [mounted, setMounted] = useState(false)
  // 懒初始化：仅在挂载时同步读取一次 localStorage
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          // 清洗旧数据：仅保留新结构需要的字段
          return parsed
            .filter((x: unknown): x is { id: string; timestamp: number; config: ExportOptions } =>
              typeof x === 'object' && x !== null
              && typeof (x as Record<string, unknown>).id === 'string'
              && typeof (x as Record<string, unknown>).timestamp === 'number'
              && typeof (x as Record<string, unknown>).config === 'object'
              && (x as Record<string, unknown>).config !== null
            )
            .map((x): SavedConfig => ({
              id: x.id,
              timestamp: x.timestamp,
              config: x.config
            }))
        }
      }
    } catch {
      // 解析失败静默忽略
    }
    return []
  })

  const writerRef = useRef<HanziWriter | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animatingRef = useRef(false)
  const pausedRef = useRef(false)
  const loopRef = useRef(false)
  const strokeIndexRef = useRef(0)
  const isComposingRef = useRef(false) // 标记是否正在使用输入法输入拼音

  // 智能处理输入变化：打拼音时不截断，确认汉字或复制粘贴时只保留最后一个字
  const handleInputChange = (val: string) => {
    if (isComposingRef.current) {
      setInputChar(val) // 拼音输入中，允许展示完整字母（如 yong）
    } else {
      setInputChar(val.trim().slice(-1)) // 非拼音输入状态下（如直接输入、粘贴），强制只留最后一个字符
    }
  }

  // 初始化汉字
  const loadChar = (newChar: string) => {
    if (!newChar.trim()) return

    setChar(newChar)
    setState('idle')
    setCurrentStroke(0)
    animatingRef.current = false
    setIsPausedState(false)
    strokeIndexRef.current = 0

    // 清理旧的 writer
    if (writerRef.current) {
      writerRef.current = null
    }

    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }

    // 创建新的 writer 实例 - 水墨风格 (Ghost 轮廓颜色绑定 exportGhostColor)
    const writer = HanziWriter.create(containerRef.current!, newChar, {
      width: 240,
      height: 240,
      padding: 20,
      showOutline: true,
      outlineColor: exportGhostColor,
      strokeColor: exportStrokeColor,
      radicalColor: '#c41e3a',
      highlightColor: exportCurrentStrokeColor,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 600,
      showCharacter: false,
      renderer: 'svg'
    })

    writerRef.current = writer

    // 获取笔划数据
    HanziWriter.loadCharacterData(newChar).then((data) => {
      if (data && 'strokes' in data) {
        setTotalStrokes(data.strokes.length)
        setStrokePaths(data.strokes)
      }
    })
  }

  // 处理输入
  const handleInput = () => {
    const trimmed = inputChar.trim()
    if (trimmed) {
      const targetChar = trimmed.slice(-1) // 提取最后一个字符（适用于输入完词组后提取字）
      loadChar(targetChar)
      setInputChar(targetChar) // 将输入框回填为单字，保持界面整洁
    }
  }

  // 开始动画
  const startAnimation = () => {
    if (!writerRef.current) return

    animatingRef.current = true
    pausedRef.current = false
    setIsPausedState(false)
    setState('playing')

    writerRef.current.hideOutline()

    strokeIndexRef.current = 0
    setCurrentStroke(0)

    const animateNextStroke = () => {
      if (!animatingRef.current || !writerRef.current) return

      if (pausedRef.current) return

      const idx = strokeIndexRef.current
      if (idx < totalStrokes) {
        writerRef.current.animateStroke(idx, {
          onComplete: () => {
            // 暂停时直接返回，不继续下一笔
            if (pausedRef.current || !animatingRef.current) return

            strokeIndexRef.current++
            setCurrentStroke(strokeIndexRef.current)
            if (strokeIndexRef.current < totalStrokes && animatingRef.current) {
              setTimeout(animateNextStroke, 600)
            } else if (strokeIndexRef.current >= totalStrokes && animatingRef.current) {
              animationComplete()
            }
          }
        })
      }
    }

    animateNextStroke()
  }

  // 继续播放（从暂停恢复）
  const resumeAnimation = () => {
    if (!animatingRef.current || !writerRef.current) return

    pausedRef.current = false
    setIsPausedState(false)
    setState('playing')

    const idx = strokeIndexRef.current
    if (idx < totalStrokes) {
      writerRef.current.animateStroke(idx, {
        onComplete: () => {
          if (pausedRef.current || !animatingRef.current) return

          strokeIndexRef.current++
          setCurrentStroke(strokeIndexRef.current)
          if (strokeIndexRef.current < totalStrokes && animatingRef.current) {
            setTimeout(() => {
              if (!pausedRef.current && animatingRef.current) {
                resumeAnimation()
              }
            }, 600)
          } else if (strokeIndexRef.current >= totalStrokes && animatingRef.current) {
            animationComplete()
          }
        }
      })
    }
  }

  // 动画完成
  const animationComplete = () => {
    animatingRef.current = false
    setState('complete')

    if (loopRef.current) {
      setTimeout(() => {
        resetState()
        setTimeout(startAnimation, 300)
      }, 1500)
    }
  }

  // 暂停/继续
  const togglePause = () => {
    if (!animatingRef.current) return

    if (pausedRef.current) {
      // 继续播放
      resumeAnimation()
    } else {
      // 暂停
      pausedRef.current = true
      setIsPausedState(true)
      setState('paused')
    }
  }

  // 重置
  const resetAndRestart = () => {
    if (!writerRef.current) return

    animatingRef.current = false
    pausedRef.current = false
    setIsPausedState(false)

    writerRef.current.hideCharacter()
    writerRef.current.showOutline()

    setCurrentStroke(0)
    setState('idle')
  }

  // 切换循环
  const toggleLoop = () => {
    loopRef.current = !loopRef.current
    setIsLooping(loopRef.current)
  }

  // 仅重置状态（不改变循环设置）
  const resetState = () => {
    if (!writerRef.current) return

    animatingRef.current = false
    pausedRef.current = false
    setIsPausedState(false)
    strokeIndexRef.current = 0

    writerRef.current.hideCharacter()
    writerRef.current.showOutline()

    setCurrentStroke(0)
    setState('idle')
  }

  // 下载 SVG
  const downloadSvg = (svgContent: string, filename: string) => {
    // 确保 SVG 包含 xmlns 属性，否则浏览器无法独立渲染
    if (!svgContent.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svgContent = svgContent.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    }
    // 添加 XML 声明头
    const fullSvg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgContent
    const blob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  // 田字格 SVG（米字格，在 1024×1024 坐标系中，采用不透明度阶梯）
  const buildGridSvg = (opts: ExportOptions): string => {
    const borderW = opts.gridBorderWidth * 4
    const dashedW = opts.gridDashedWidth * 4
    return [
      '  <!-- 田字格 -->',
      `  <line x1="0" y1="512" x2="1024" y2="512" stroke="${opts.gridDashedColor}" stroke-opacity="0.6" stroke-width="${dashedW}" stroke-dasharray="32 24"/>`,
      `  <line x1="512" y1="0" x2="512" y2="1024" stroke="${opts.gridDashedColor}" stroke-opacity="0.6" stroke-width="${dashedW}" stroke-dasharray="32 24"/>`,
      `  <line x1="0" y1="0" x2="1024" y2="1024" stroke="${opts.gridDashedColor}" stroke-opacity="0.6" stroke-width="${dashedW}" stroke-dasharray="32 24"/>`,
      `  <line x1="1024" y1="0" x2="0" y2="1024" stroke="${opts.gridDashedColor}" stroke-opacity="0.6" stroke-width="${dashedW}" stroke-dasharray="32 24"/>`,
      `  <rect x="8" y="8" width="1008" height="1008" fill="none" stroke="${opts.gridBorderColor}" stroke-opacity="1" stroke-width="${borderW}" rx="16"/>`,
    ].join('\n')
  }

  // Ghost 字（所有笔划用浅色显示）
  const buildGhostSvg = (strokes: string[], color: string): string => {
    return strokes.map(s => `    <path d="${s}" fill="${color}" />`).join('\n')
  }

  type ExportOptions = {
    grid: boolean
    ghost: boolean
    gridBorderColor: string
    gridBorderWidth: number
    gridDashedColor: string
    gridDashedWidth: number
    ghostColor: string
    strokeColor: string
    currentStrokeColor: string
  }

  type SavedConfig = {
    id: string
    timestamp: number
    config: ExportOptions
  }

  // 构建累积笔划 SVG
  const buildStrokeSvg = (strokes: string[], strokeCount: number, opts: ExportOptions): string => {
    const gridPart = opts.grid ? '\n' + buildGridSvg(opts) : ''
    const ghostPart = opts.ghost ? '\n' + buildGhostSvg(strokes, opts.ghostColor) : ''
    let activePaths = ''
    for (let i = 0; i < strokeCount; i++) {
      const color = (i === strokeCount - 1) ? opts.currentStrokeColor : opts.strokeColor
      activePaths += `\n    <path d="${strokes[i]}" fill="${color}" />`
    }
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 1024 1024">',
      gridPart,
      '  <g transform="translate(0, 900) scale(1, -1)">',
      ghostPart,
      activePaths,
      '  </g>',
      '</svg>'
    ].join('\n')
  }

  // 构建单独一笔的 SVG
  const buildIndividualStrokeSvg = (strokes: string[], strokeIndex: number, opts: ExportOptions): string => {
    const gridPart = opts.grid ? '\n' + buildGridSvg(opts) : ''
    const ghostPart = opts.ghost ? '\n' + buildGhostSvg(strokes, opts.ghostColor) : ''
    const activePath = `\n    <path d="${strokes[strokeIndex]}" fill="${opts.currentStrokeColor}" />`
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 1024 1024">',
      gridPart,
      '  <g transform="translate(0, 900) scale(1, -1)">',
      ghostPart,
      activePath,
      '  </g>',
      '</svg>'
    ].join('\n')
  }

  // 构建"风格样片"SVG：抽象展示配置（不含任何具体汉字）
  const buildStyleTileSvg = (opts: ExportOptions): string => {
    const borderW = Math.max(1, opts.gridBorderWidth * 0.5)
    const dashedW = Math.max(0.6, opts.gridDashedWidth * 0.5)
    const gridParts: string[] = []
    if (opts.grid) {
      gridParts.push(`<rect x="2" y="2" width="96" height="96" fill="none" stroke="${opts.gridBorderColor}" stroke-width="${borderW}" rx="2"/>`)
      gridParts.push(`<line x1="50" y1="2" x2="50" y2="98" stroke="${opts.gridDashedColor}" stroke-width="${dashedW}" stroke-dasharray="3 2"/>`)
      gridParts.push(`<line x1="2" y1="50" x2="98" y2="50" stroke="${opts.gridDashedColor}" stroke-width="${dashedW}" stroke-dasharray="3 2"/>`)
    }
    const ghostPart = opts.ghost
      ? `<line x1="22" y1="78" x2="78" y2="22" stroke="${opts.ghostColor}" stroke-width="8" stroke-linecap="round"/>`
      : ''
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
      ...gridParts,
      ghostPart,
      `<line x1="22" y1="78" x2="78" y2="22" stroke="${opts.strokeColor}" stroke-width="5" stroke-linecap="round"/>`,
      `<circle cx="78" cy="22" r="3.5" fill="${opts.currentStrokeColor}"/>`,
      '</svg>'
    ].join('')
  }

  // 时间格式化：MM/DD HH:mm
  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const getExportOpts = (): ExportOptions => ({
    grid: exportWithGrid,
    ghost: exportWithGhost,
    gridBorderColor: exportGridBorderColor,
    gridBorderWidth: exportGridBorderWidth,
    gridDashedColor: exportGridDashedColor,
    gridDashedWidth: exportGridDashedWidth,
    ghostColor: exportGhostColor,
    strokeColor: exportStrokeColor,
    currentStrokeColor: exportCurrentStrokeColor
  })

  // 准备 SVG 内容（加 XML 头）
  const prepareSvg = (svgContent: string): string => {
    if (!svgContent.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svgContent = svgContent.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + svgContent
  }

  // 下载累积笔划 SVG（单个）
  const downloadSingleStroke = async (strokeCount: number) => {
    const data = await HanziWriter.loadCharacterData(char)
    if (!data || !('strokes' in data)) return
    // 如果是 0 笔（即底字），无论是否勾选 Ghost，都要强制导出 Ghost 底字
    const opts = strokeCount === 0 ? { ...getExportOpts(), ghost: true } : getExportOpts()
    const svgContent = buildStrokeSvg(data.strokes, strokeCount, opts)
    downloadSvg(svgContent, `${char}_${String(strokeCount).padStart(2, '0')}.svg`)
  }

  // 下载单独一笔 SVG（单个）
  const downloadIndividualStroke = async (strokeIndex: number) => {
    const data = await HanziWriter.loadCharacterData(char)
    if (!data || !('strokes' in data) || strokeIndex >= data.strokes.length) return
    const svgContent = buildIndividualStrokeSvg(data.strokes, strokeIndex, getExportOpts())
    downloadSvg(svgContent, `${char}_第${strokeIndex + 1}笔.svg`)
  }

  // 一键导出累积笔划 ZIP
  const exportAllStrokesZip = async () => {
    saveCurrentConfig()
    const data = await HanziWriter.loadCharacterData(char)
    if (!data || !('strokes' in data)) return
    const opts = getExportOpts()
    const zip = new JSZip()
    for (let i = 0; i <= data.strokes.length; i++) {
      // 如果是第 0 笔，强制开启 ghost，保证第 0 笔一定有底字
      const currentOpts = i === 0 ? { ...opts, ghost: true } : opts
      const svg = prepareSvg(buildStrokeSvg(data.strokes, i, currentOpts))
      zip.file(`${char}_累积_${String(i).padStart(2, '0')}.svg`, svg)
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${char}_累积笔划.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  // 一键导出单独笔划 ZIP
  const exportAllIndividualStrokesZip = async () => {
    saveCurrentConfig()
    const data = await HanziWriter.loadCharacterData(char)
    if (!data || !('strokes' in data)) return
    const opts = getExportOpts()
    const zip = new JSZip()
    
    // 导出第 0 笔时，强制开启 ghost：无论用户是否勾选 Ghost 底字，底字底图都必须包含字形
    const zeroSvg = prepareSvg(buildStrokeSvg(data.strokes, 0, { ...opts, ghost: true }))
    // 文件名统一使用两位数零填充格式以保证排序的绝对正确
    zip.file(`${char}_00.svg`, zeroSvg)
    
    for (let i = 0; i < data.strokes.length; i++) {
      const svg = prepareSvg(buildIndividualStrokeSvg(data.strokes, i, opts))
      zip.file(`${char}_${String(i + 1).padStart(2, '0')}.svg`, svg)
    }

    zip.file('1_双击我自动生成PPT动画.vbs', buildIndividualVbs())

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${char}_单独笔划.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  // 生成 PPT 动画自动组装 VBS 脚本（仅 Windows 可用）
  const buildIndividualVbs = (): string => {
    const vbsScript = `
Set objFSO = CreateObject("Scripting.FileSystemObject")
strFolder = objFSO.GetParentFolderName(WScript.ScriptFullName)
Set objPPT = CreateObject("PowerPoint.Application")
objPPT.Visible = True
Set objPres = objPPT.Presentations.Add()
Set objSlide = objPres.Slides.Add(1, 12) ' 12 = Blank Layout

slideWidth = objPres.PageSetup.SlideWidth
slideHeight = objPres.PageSetup.SlideHeight
size = 400
leftPos = (slideWidth - size) / 2
topPos = (slideHeight - size) / 2

Set objFolder = objFSO.GetFolder(strFolder)
Set colFiles = objFolder.Files
Dim arrFiles()
count = 0
For Each objFile In colFiles
    If LCase(objFSO.GetExtensionName(objFile.Name)) = "svg" Then
        ReDim Preserve arrFiles(count)
        arrFiles(count) = objFile.Name
        count = count + 1
    End If
Next

' Bubble sort files by name to guarantee sequence: 00, 01, 02...
If count > 1 Then
    For i = 0 To count - 2
        For j = 0 To count - 2 - i
            If arrFiles(j) > arrFiles(j+1) Then
                temp = arrFiles(j)
                arrFiles(j) = arrFiles(j+1)
                arrFiles(j+1) = temp
            End If
        Next
    Next
End If

' 1. Load all shapes onto the slide and apply animations directly
For i = 0 To count - 1
    fullPath = strFolder & "\\" & arrFiles(i)
    Set shape = objSlide.Shapes.AddPicture(fullPath, 0, -1, leftPos, topPos, size, size)

    If InStr(arrFiles(i), "_00.svg") > 0 Then
        ' Background image, no animation needed
    ElseIf InStr(arrFiles(i), "_01.svg") > 0 Then
        ' First stroke: click to start (Trigger = 1), Animation Wipe = 22
        Set eff = objSlide.TimeLine.MainSequence.AddEffect(shape, 22, 0, 1)
        eff.EffectParameters.Direction = 1
        eff.Timing.Duration = 0.5
    Else
        ' Following strokes: after previous (Trigger = 3), Animation Wipe = 22
        Set eff = objSlide.TimeLine.MainSequence.AddEffect(shape, 22, 0, 3)
        eff.EffectParameters.Direction = 1
        eff.Timing.Duration = 0.5
    End If
Next
`.trim().replace(/\n/g, '\r\n')

    const msgText = "PPT 动画生成完毕！\n\n【重要提示】\n为了保证动画可以被自由修改且正常叠加，这些笔划不能被打成组合。\n请直接在此幻灯片按下【Ctrl + A】全选，然后【Ctrl + C】复制。\n\n（注意：由于跨软件剪贴板的格式限制，复制的动画仅支持粘贴到同为 PowerPoint 的课件中。如果粘贴到 WPS 中，动画可能会失效！）"
    const msgCode = msgText.split('').map(c => c === '\n' ? 'vbCrLf' : `ChrW(${c.charCodeAt(0)})`).join(' & ')
    const titleCode = "笔墨习字 - 成功".split('').map(c => `ChrW(${c.charCodeAt(0)})`).join(' & ')

    const vbsFooter = `MsgBox ${msgCode}, 64, ${titleCode}`
    return vbsScript + "\r\n" + vbsFooter
  }

  // 一键导出全部（累积笔划 + 单独笔划）ZIP
  const exportAllZip = async () => {
    saveCurrentConfig()
    const data = await HanziWriter.loadCharacterData(char)
    if (!data || !('strokes' in data)) return
    const opts = getExportOpts()
    const zip = new JSZip()

    // 累积笔划子包
    const cumulativeFolder = zip.folder(`${char}_累积笔划`)
    if (!cumulativeFolder) return
    for (let i = 0; i <= data.strokes.length; i++) {
      const currentOpts = i === 0 ? { ...opts, ghost: true } : opts
      const svg = prepareSvg(buildStrokeSvg(data.strokes, i, currentOpts))
      cumulativeFolder.file(`${char}_累积_${String(i).padStart(2, '0')}.svg`, svg)
    }

    // 单独笔划子包（含 VBS 脚本）
    const individualFolder = zip.folder(`${char}_单独笔划`)
    if (!individualFolder) return
    const zeroSvg = prepareSvg(buildStrokeSvg(data.strokes, 0, { ...opts, ghost: true }))
    individualFolder.file(`${char}_00.svg`, zeroSvg)
    for (let i = 0; i < data.strokes.length; i++) {
      const svg = prepareSvg(buildIndividualStrokeSvg(data.strokes, i, opts))
      individualFolder.file(`${char}_${String(i + 1).padStart(2, '0')}.svg`, svg)
    }
    individualFolder.file('1_双击我自动生成PPT动画.vbs', buildIndividualVbs())

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${char}_全部笔划.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  // 配置记录：去重比较 + 持久化
  const isSameConfig = (a: ExportOptions, b: ExportOptions): boolean => {
    return a.grid === b.grid
      && a.ghost === b.ghost
      && a.gridBorderColor === b.gridBorderColor
      && a.gridBorderWidth === b.gridBorderWidth
      && a.gridDashedColor === b.gridDashedColor
      && a.gridDashedWidth === b.gridDashedWidth
      && a.ghostColor === b.ghostColor
      && a.strokeColor === b.strokeColor
      && a.currentStrokeColor === b.currentStrokeColor
  }

  const persistConfigs = (configs: SavedConfig[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
    } catch {
      // 存储失败（quota / 隐私模式）静默忽略
    }
  }

  // 保存当前配置（去重：已存在则仅更新时间戳并前移）
  const saveCurrentConfig = () => {
    const config = getExportOpts()
    setSavedConfigs(prev => {
      const existingIdx = prev.findIndex(s => isSameConfig(s.config, config))
      let next: SavedConfig[]
      if (existingIdx >= 0) {
        next = [...prev]
        next[existingIdx] = { ...next[existingIdx], timestamp: Date.now() }
        // 把被更新的项移到最前
        const updated = next.splice(existingIdx, 1)[0]
        next = [updated, ...next]
      } else {
        next = [
          {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            config
          },
          ...prev
        ].slice(0, MAX_CONFIGS)
      }
      persistConfigs(next)
      return next
    })
  }

  // 应用某个已保存的配置
  const applyConfig = (config: ExportOptions) => {
    setExportWithGrid(config.grid)
    setExportWithGhost(config.ghost)
    setExportGridBorderColor(config.gridBorderColor)
    setExportGridBorderWidth(config.gridBorderWidth)
    setExportGridDashedColor(config.gridDashedColor)
    setExportGridDashedWidth(config.gridDashedWidth)
    setExportGhostColor(config.ghostColor)
    setExportStrokeColor(config.strokeColor)
    setExportCurrentStrokeColor(config.currentStrokeColor)
  }

  // 删除某个已保存的配置
  const deleteConfig = (id: string) => {
    setSavedConfigs(prev => {
      const next = prev.filter(s => s.id !== id)
      persistConfigs(next)
      return next
    })
  }

  // 标记客户端挂载完成（用于 hydration 一致性）
  useEffect(() => {
    setMounted(true)
  }, [])

  // 初始化及颜色更新
  useEffect(() => {
    loadChar(char)
  }, [char, exportGhostColor, exportStrokeColor])


  return (
    <div className="min-h-screen ink-background relative overflow-hidden">
      {/* 装饰性云纹 */}
      <div className="absolute top-0 left-0 w-1/3 h-32 opacity-10 cloud-pattern" />
      <div className="absolute top-0 right-0 w-1/4 h-24 opacity-10 cloud-pattern" />
      <div className="absolute bottom-0 left-1/4 w-1/3 h-28 opacity-10 cloud-pattern" />

      <div className="relative z-10 px-4 py-8 md:py-10">
        {/* 右上角 GitHub 链接 */}
        <a
          href="https://github.com/liuxin2533/hanzi-writer"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub 仓库"
          title="GitHub 仓库"
          className="absolute top-2 right-2 md:top-4 md:right-4 text-ink-light hover:text-ink transition-colors z-20"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
        {/* 标题 - 全宽 */}
        <header className="text-center mb-6 md:mb-8 animate-fade-in">
          <div className="inline-block relative">
            <div className="w-48 h-1 bg-gradient-to-r from-transparent via-amber-800 to-transparent mb-3 mx-auto" />
            <h1 className="text-4xl md:text-5xl font-calligraphy text-ink mb-1 tracking-wider">
              笔墨 · 习字
            </h1>
            <p className="text-sm text-ink-light font-light tracking-widest">
              汉字笔顺 · 静心书写
            </p>
            <div className="w-48 h-1 bg-gradient-to-r from-transparent via-amber-800 to-transparent mt-3 mx-auto" />
          </div>
        </header>

        {/* 左右分栏主内容 */}
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-6 md:gap-8 items-start">
          {/* ============ 左侧：习字区 ============ */}
          <div className="md:w-[480px] md:shrink-0 flex flex-col items-center w-full md:sticky md:top-4">
            {/* 字符显示 - 屏风风格 */}
            <div className="relative p-6 md:p-8 rounded-lg screen-frame animate-scale-in">
              <div className="relative">
                <div className="absolute inset-0 paper-texture rounded" />

                {exportWithGrid && (
                  <svg className="absolute inset-0 w-[240px] h-[240px]" viewBox="0 0 240 240">
                    <line x1="0" y1="120" x2="240" y2="120" stroke={exportGridDashedColor} strokeOpacity="0.6" strokeWidth={exportGridDashedWidth} strokeDasharray="8 6" />
                    <line x1="120" y1="0" x2="120" y2="240" stroke={exportGridDashedColor} strokeOpacity="0.6" strokeWidth={exportGridDashedWidth} strokeDasharray="8 6" />
                    <line x1="0" y1="0" x2="240" y2="240" stroke={exportGridDashedColor} strokeOpacity="0.6" strokeWidth={exportGridDashedWidth} strokeDasharray="8 6" />
                    <line x1="240" y1="0" x2="0" y2="240" stroke={exportGridDashedColor} strokeOpacity="0.6" strokeWidth={exportGridDashedWidth} strokeDasharray="8 6" />
                    <rect
                      x={exportGridBorderWidth / 2}
                      y={exportGridBorderWidth / 2}
                      width={240 - exportGridBorderWidth}
                      height={240 - exportGridBorderWidth}
                      fill="none"
                      stroke={exportGridBorderColor}
                      strokeOpacity="1"
                      strokeWidth={exportGridBorderWidth}
                      rx="4"
                    />
                  </svg>
                )}

                <div
                  ref={containerRef}
                  className="relative w-[240px] h-[240px] z-10"
                  id="hanzi-writer-container"
                />
                <style>{`
                  #hanzi-writer-container svg > g > g:nth-of-type(2) > path {
                    stroke: ${exportStrokeColor} !important;
                  }
                  #hanzi-writer-container svg > g > g:nth-of-type(2) > path:nth-of-type(${currentStroke + 1}) {
                    stroke: ${exportCurrentStrokeColor} !important;
                  }
                `}</style>
              </div>
            </div>

            {/* 输入区域 - 印章风格 */}
            <div className="mt-6 flex items-center gap-4 animate-slide-up">
              <input
                type="text"
                value={inputChar}
                onChange={(e) => handleInputChange(e.target.value)}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false
                  handleInputChange(e.currentTarget.value)
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleInput()}
                placeholder="笔"
                className="w-16 h-14 text-3xl text-center border-2 border-ink-light bg-transparent rounded-lg focus:border-cinnabar focus:outline-none transition-all placeholder:text-ink-light placeholder:opacity-40 font-calligraphy"
              />
              <button
                onClick={handleInput}
                className="group relative px-6 py-3 overflow-hidden rounded-lg transition-all duration-300 hover:scale-105"
              >
                <div className="absolute inset-0 bg-cinnabar opacity-90 group-hover:opacity-100 transition-opacity" />
                <span className="relative text-white font-medium tracking-wide">习字</span>
              </button>
            </div>

            {/* 状态显示 */}
            <div className="mt-6 flex items-center gap-6 text-sm animate-slide-up-delay">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full transition-all duration-500 ${state === 'idle' ? 'bg-ink-light opacity-50' :
                    state === 'playing' ? 'bg-cinnabar animate-pulse-gentle' :
                      state === 'paused' ? 'bg-amber-600' :
                        'bg-jade'
                  }`} />
                <span className="text-ink-light font-light tracking-wide">
                  {state === 'idle' ? '待命' : state === 'playing' ? '书写中' : state === 'paused' ? '已暂停' : '书毕'}
                </span>
              </div>
              <div className="text-ink-light font-light tracking-wider">
                <span className="opacity-70">笔划 </span>
                <span className="font-medium text-ink">{currentStroke}</span>
                <span className="opacity-50 mx-1">/</span>
                <span>{totalStrokes}</span>
              </div>
            </div>

            {/* 控制按钮组 - 印章风格 */}
            <div className="flex flex-wrap justify-center gap-3 mt-6 animate-slide-up-delay-2">
              {state === 'idle' ? (
                <button
                  onClick={startAnimation}
                  disabled={totalStrokes === 0}
                  className="stamp-btn group disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-xl">▶</span>
                  <span className="relative">起笔</span>
                </button>
              ) : (
                <button
                  onClick={resetState}
                  disabled={totalStrokes === 0}
                  className="stamp-btn group disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-xl">↺</span>
                  <span className="relative">重书</span>
                </button>
              )}

              <button
                onClick={togglePause}
                disabled={state !== 'playing' && state !== 'paused'}
                className="stamp-btn group disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-xl">{isPaused ? '▶' : '⏸'}</span>
                <span className="relative">{isPaused ? '续写' : '暂停'}</span>
              </button>

              <button
                onClick={resetAndRestart}
                disabled={state === 'idle'}
                className="stamp-btn group disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-xl">↻</span>
                <span className="relative">复原</span>
              </button>

              <button
                onClick={toggleLoop}
                className={`stamp-btn group transition-all ${isLooping ? 'bg-jade bg-opacity-90 text-white' : ''}`}
              >
                <span className="text-xl">🔁</span>
                <span className="relative">{isLooping ? '循环' : '周始'}</span>
              </button>
            </div>
          </div>

          {/* ============ 右侧：配置区 ============ */}
          <div className="flex-1 w-full min-w-0">
            <div className="p-4 md:p-6 bg-paper-dark rounded-lg border border-wood-light">
              <h3 className="text-xl font-calligraphy text-ink mb-5 text-center tracking-wider">画面与导出配置</h3>

              {/* 样式设置：两列 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                {/* 田字格样式 */}
                <div className="p-3 bg-paper rounded-lg border border-wood-light flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink border-b border-wood-light pb-1.5 flex items-center gap-1.5">
                    <span>田</span> 格线样式
                  </h4>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={exportWithGrid}
                        onChange={(e) => setExportWithGrid(e.target.checked)}
                        className="w-4 h-4 accent-cinnabar"
                      />
                      <span className="text-sm text-ink font-medium">启用格线</span>
                    </label>
                  </div>
                  {exportWithGrid && (
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink-light">边框颜色</span>
                        <input
                          type="color"
                          value={exportGridBorderColor}
                          onChange={(e) => setExportGridBorderColor(e.target.value)}
                          className="w-8 h-6 p-0 border border-wood-light rounded cursor-pointer bg-transparent"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink-light">边框粗细 (px)</span>
                        <input
                          type="number"
                          min="0.1"
                          max="20"
                          step="0.1"
                          value={exportGridBorderWidth}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setExportGridBorderWidth(isNaN(val) ? 0 : val);
                          }}
                          className="w-16 px-2 py-0.5 text-xs text-center border border-wood-light bg-paper rounded focus:border-cinnabar focus:outline-none text-ink font-mono"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink-light">虚线颜色</span>
                        <input
                          type="color"
                          value={exportGridDashedColor}
                          onChange={(e) => setExportGridDashedColor(e.target.value)}
                          className="w-8 h-6 p-0 border border-wood-light rounded cursor-pointer bg-transparent"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink-light">虚线粗细 (px)</span>
                        <input
                          type="number"
                          min="0.1"
                          max="20"
                          step="0.1"
                          value={exportGridDashedWidth}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setExportGridDashedWidth(isNaN(val) ? 0 : val);
                          }}
                          className="w-16 px-2 py-0.5 text-xs text-center border border-wood-light bg-paper rounded focus:border-cinnabar focus:outline-none text-ink font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 笔划样式 */}
                <div className="p-3 bg-paper rounded-lg border border-wood-light flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink border-b border-wood-light pb-1.5 flex items-center gap-1.5">
                    <span>笔</span> 墨迹与底字
                  </h4>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink font-medium">常规笔划颜色</span>
                    <input
                      type="color"
                      value={exportStrokeColor}
                      onChange={(e) => setExportStrokeColor(e.target.value)}
                      className="w-8 h-6 p-0 border border-wood-light rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink font-medium">当前笔划颜色</span>
                    <input
                      type="color"
                      value={exportCurrentStrokeColor}
                      onChange={(e) => setExportCurrentStrokeColor(e.target.value)}
                      className="w-8 h-6 p-0 border border-wood-light rounded cursor-pointer bg-transparent"
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={exportWithGhost}
                        onChange={(e) => setExportWithGhost(e.target.checked)}
                        className="w-4 h-4 accent-cinnabar"
                      />
                      <span className="text-sm text-ink font-medium">启用Ghost底字</span>
                    </label>
                  </div>
                  {exportWithGhost && (
                    <div className="flex items-center justify-between gap-2 mt-1 transition-all">
                      <span className="text-xs text-ink-light">底字颜色</span>
                      <input
                        type="color"
                        value={exportGhostColor}
                        onChange={(e) => setExportGhostColor(e.target.value)}
                        className="w-8 h-6 p-0 border border-wood-light rounded cursor-pointer bg-transparent"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* 笔划预览网格 */}
              <div className="flex flex-wrap justify-center gap-3 mb-5">
                {strokePaths.length > 0 && Array.from({ length: totalStrokes + 1 }, (_, i) => {
                  const svgStr = buildStrokeSvg(strokePaths, i, getExportOpts())
                  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`
                  return (
                    <div key={`${char}-${i}-${exportWithGrid}-${exportWithGhost}-${exportGridBorderColor}-${exportGridBorderWidth}-${exportGridDashedColor}-${exportGridDashedWidth}-${exportStrokeColor}-${exportCurrentStrokeColor}-${exportGhostColor}`} className="flex flex-col items-center gap-1.5">
                      <div className="relative">
                        <img
                          src={dataUrl}
                          width={64}
                          height={64}
                          alt={`${char} ${i}笔`}
                          className="w-16 h-16 bg-paper border border-wood-light rounded cursor-pointer hover:border-cinnabar transition-colors"
                        />
                        <button
                          onClick={() => downloadSingleStroke(i)}
                          className="absolute -bottom-1 -right-1 w-5 h-5 bg-jade text-white text-xs rounded-full flex items-center justify-center hover:bg-jade-light transition-colors shadow"
                        >
                          ↓
                        </button>
                      </div>
                      <span className="text-[10px] text-ink-light">{i}笔</span>
                    </div>
                  )
                })}
              </div>

              {/* 导出按钮 */}
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={exportAllStrokesZip}
                  disabled={totalStrokes === 0}
                  className="px-4 py-2 bg-cinnabar text-white text-sm rounded-lg hover:bg-cinnabar-light transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span>📦</span> 导出累积笔划 ZIP
                </button>
                <button
                  onClick={exportAllIndividualStrokesZip}
                  disabled={totalStrokes === 0}
                  className="px-4 py-2 bg-ink text-white text-sm rounded-lg hover:bg-ink-light transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span>📦</span> 导出单独笔划 ZIP
                </button>
                <button
                  onClick={exportAllZip}
                  disabled={totalStrokes === 0}
                  className="px-4 py-2 bg-jade text-white text-sm rounded-lg hover:bg-jade-light transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span>📦</span> 导出全部
                </button>
              </div>

              {/* 配置记录 - 列表形式 */}
              <div className="mt-5 pt-4 border-t border-wood-light">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-ink tracking-wider">配置记录</h4>
                  <span className="text-xs text-ink-light opacity-60 font-mono">{mounted ? savedConfigs.length : 0}/{MAX_CONFIGS}</span>
                </div>
                {!mounted || savedConfigs.length === 0 ? (
                  <p className="text-xs text-ink-light text-center opacity-60 py-4">{mounted ? '暂无记录，点击上方任意导出按钮即可自动保存当前配置' : '\u00A0'}</p>
                ) : (
                  <div className="divide-y divide-wood-light/50 -mx-2">
                    {savedConfigs.map(s => {
                      const tileSvg = buildStyleTileSvg(s.config)
                      const tileUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tileSvg)}`
                      const c = s.config
                      return (
                        <div key={s.id} className="flex items-center gap-3 py-2 px-2 hover:bg-paper/40 rounded transition-colors">
                          {/* 风格样片（不含具体汉字） */}
                          <img
                            src={tileUrl}
                            alt="样式预览"
                            className="w-12 h-12 rounded border border-wood-light bg-paper shrink-0"
                          />

                          {/* 颜色 + 状态 */}
                          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                            <div className="flex gap-1">
                              <div title={`边框 ${c.gridBorderColor} ${c.gridBorderWidth}px`} style={{ background: c.gridBorderColor }} className="w-5 h-5 rounded border border-wood-light/50" />
                              <div title={`虚线 ${c.gridDashedColor} ${c.gridDashedWidth}px`} style={{ background: c.gridDashedColor }} className="w-5 h-5 rounded border border-wood-light/50" />
                              <div title={`笔划 ${c.strokeColor}`} style={{ background: c.strokeColor }} className="w-5 h-5 rounded border border-wood-light/50" />
                              <div title={`当前 ${c.currentStrokeColor}`} style={{ background: c.currentStrokeColor }} className="w-5 h-5 rounded border border-wood-light/50" />
                              <div title={`底字 ${c.ghostColor}`} style={{ background: c.ghostColor }} className="w-5 h-5 rounded border border-wood-light/50" />
                            </div>
                            <div className="flex gap-2 text-sm font-medium">
                              <span className={c.grid ? 'text-ink' : 'text-ink-light line-through opacity-60'}>格线</span>
                              <span className={c.ghost ? 'text-ink' : 'text-ink-light line-through opacity-60'}>底字</span>
                              {!c.grid && !c.ghost && <span className="text-ink-light opacity-50">纯净</span>}
                            </div>
                          </div>

                          {/* 时间 */}
                          <span
                            className="text-[11px] text-ink-light font-mono shrink-0"
                            title={new Date(s.timestamp).toLocaleString('zh-CN')}
                          >
                            {formatTime(s.timestamp)}
                          </span>

                          {/* 操作 */}
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => applyConfig(c)}
                              className="text-xs px-2 py-1 bg-jade text-white rounded hover:opacity-80 transition-opacity"
                              title="应用此配置"
                            >应用</button>
                            <button
                              onClick={() => deleteConfig(s.id)}
                              className="text-xs w-7 h-7 bg-cinnabar text-white rounded hover:opacity-80 transition-opacity flex items-center justify-center leading-none"
                              title="删除"
                            >×</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 底部装饰诗句 */}
        <footer className="mt-10 text-center animate-fade-in-delay">
          <p className="text-sm text-ink-light opacity-60 font-light tracking-widest">
            笔落惊风雨，诗成泣鬼神
          </p>
        </footer>
      </div>
    </div>
  )
}