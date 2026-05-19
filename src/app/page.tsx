'use client'

import { useState, useRef, useEffect } from 'react'
import HanziWriter from 'hanzi-writer'
import JSZip from 'jszip'

type AnimationState = 'idle' | 'playing' | 'paused' | 'complete'

export default function Home() {
  const [char, setChar] = useState('永')
  const [inputChar, setInputChar] = useState('永')
  const [state, setState] = useState<AnimationState>('idle')
  const [currentStroke, setCurrentStroke] = useState(0)
  const [totalStrokes, setTotalStrokes] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [isPaused, setIsPausedState] = useState(false)
  const [exportWithGrid, setExportWithGrid] = useState(true)
  const [exportWithGhost, setExportWithGhost] = useState(true)
  const [exportGridColor, setExportGridColor] = useState('#8b7355') // 默认古朴木褐色
  const [exportGhostColor, setExportGhostColor] = useState('#d4c5b0') // 默认浅古沙色
  const [strokePaths, setStrokePaths] = useState<string[]>([])

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
      strokeColor: '#1a1a1a',
      radicalColor: '#c41e3a',
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
  const buildGridSvg = (color: string): string => {
    return [
      '  <!-- 田字格 -->',
      `  <rect x="8" y="8" width="1008" height="1008" fill="none" stroke="${color}" stroke-opacity="1" stroke-width="8" rx="16"/>`,
      `  <line x1="0" y1="512" x2="1024" y2="512" stroke="${color}" stroke-opacity="0.6" stroke-width="5" stroke-dasharray="32 24"/>`,
      `  <line x1="512" y1="0" x2="512" y2="1024" stroke="${color}" stroke-opacity="0.6" stroke-width="5" stroke-dasharray="32 24"/>`,
      `  <line x1="0" y1="0" x2="1024" y2="1024" stroke="${color}" stroke-opacity="0.4" stroke-width="4"/>`,
      `  <line x1="1024" y1="0" x2="0" y2="1024" stroke="${color}" stroke-opacity="0.4" stroke-width="4"/>`,
    ].join('\n')
  }

  // Ghost 字（所有笔划用浅色显示）
  const buildGhostSvg = (strokes: string[], color: string): string => {
    return strokes.map(s => `    <path d="${s}" fill="${color}" />`).join('\n')
  }

  type ExportOptions = { grid: boolean; ghost: boolean; gridColor: string; ghostColor: string }

  // 构建累积笔划 SVG
  const buildStrokeSvg = (strokes: string[], strokeCount: number, opts: ExportOptions): string => {
    const gridPart = opts.grid ? '\n' + buildGridSvg(opts.gridColor) : ''
    const ghostPart = opts.ghost ? '\n' + buildGhostSvg(strokes, opts.ghostColor) : ''
    let activePaths = ''
    for (let i = 0; i < strokeCount; i++) {
      activePaths += `\n    <path d="${strokes[i]}" fill="#1a1a1a" />`
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
    const gridPart = opts.grid ? '\n' + buildGridSvg(opts.gridColor) : ''
    const ghostPart = opts.ghost ? '\n' + buildGhostSvg(strokes, opts.ghostColor) : ''
    const activePath = `\n    <path d="${strokes[strokeIndex]}" fill="#1a1a1a" />`
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

  const getExportOpts = (): ExportOptions => ({
    grid: exportWithGrid,
    ghost: exportWithGhost,
    gridColor: exportGridColor,
    ghostColor: exportGhostColor
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

    // 注入自动组装 PPT 动画的 VBScript 脚本（仅 Windows 可用）
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
    const finalVbs = vbsScript + "\r\n" + vbsFooter

    zip.file('1_双击我自动生成PPT动画.vbs', finalVbs)

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${char}_单独笔划.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  // 初始化及颜色更新
  useEffect(() => {
    loadChar(char)
  }, [char, exportGhostColor])

  return (
    <div className="min-h-screen ink-background relative overflow-hidden">
      {/* 装饰性云纹 */}
      <div className="absolute top-0 left-0 w-1/3 h-32 opacity-10 cloud-pattern" />
      <div className="absolute top-0 right-0 w-1/4 h-24 opacity-10 cloud-pattern" />
      <div className="absolute bottom-0 left-1/4 w-1/3 h-28 opacity-10 cloud-pattern" />

      {/* 主容器 */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">

        {/* 标题区域 - 卷轴风格 */}
        <header className="text-center mb-10 animate-fade-in">
          <div className="inline-block relative">
            {/* 上装饰 */}
            <div className="w-48 h-1 bg-gradient-to-r from-transparent via-amber-800 to-transparent mb-4 mx-auto" />

            <h1 className="text-5xl md:text-6xl font-calligraphy text-ink mb-2 tracking-wider">
              笔墨 · 习字
            </h1>

            <p className="text-base text-ink-light font-light tracking-widest">
              汉字笔顺 · 静心书写
            </p>

            {/* 下装饰 */}
            <div className="w-48 h-1 bg-gradient-to-r from-transparent via-amber-800 to-transparent mt-4 mx-auto" />
          </div>
        </header>

        {/* 中央书写区域 */}
        <div className="relative flex flex-col items-center">

          {/* 外框装饰 - 屏风风格 */}
          <div className="relative p-6 md:p-8 rounded-lg screen-frame animate-scale-in">

            {/* 田字格容器 */}
            <div className="relative">
              {/* 宣纸纹理背景 */}
              <div className="absolute inset-0 paper-texture rounded" />

              {/* 田字格背景 */}
              <svg className="absolute inset-0 w-[240px] h-[240px]" viewBox="0 0 240 240">
                {/* 外框 */}
                <rect x="2" y="2" width="236" height="236" fill="none" stroke={exportGridColor} strokeOpacity="1" strokeWidth="2" rx="4" />
                {/* 米字格中心线 */}
                <line x1="0" y1="120" x2="240" y2="120" stroke={exportGridColor} strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="8 6" />
                <line x1="120" y1="0" x2="120" y2="240" stroke={exportGridColor} strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="8 6" />
                {/* 对角线 */}
                <line x1="0" y1="0" x2="240" y2="240" stroke={exportGridColor} strokeOpacity="0.4" strokeWidth="1" />
                <line x1="240" y1="0" x2="0" y2="240" stroke={exportGridColor} strokeOpacity="0.4" strokeWidth="1" />
              </svg>

              {/* 汉字渲染区 */}
              <div
                ref={containerRef}
                className="relative w-[240px] h-[240px] z-10"
              />
            </div>
          </div>

          {/* 输入区域 - 印章风格 */}
          <div className="mt-8 flex items-center gap-4 animate-slide-up">
            <div className="relative">
              <input
                type="text"
                value={inputChar}
                onChange={(e) => handleInputChange(e.target.value)}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false
                  handleInputChange((e.target as HTMLInputElement).value)
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleInput()}
                placeholder="字"
                className="w-16 h-14 text-3xl text-center border-2 border-ink-light bg-transparent rounded-lg focus:border-cinnabar focus:outline-none transition-all placeholder:text-ink-light placeholder:opacity-40 font-calligraphy"
              />
            </div>
            <button
              onClick={handleInput}
              className="group relative px-6 py-3 overflow-hidden rounded-lg transition-all duration-300 hover:scale-105"
            >
              <div className="absolute inset-0 bg-cinnabar opacity-90 group-hover:opacity-100 transition-opacity" />
              <span className="relative text-white font-medium tracking-wide">习字</span>
            </button>
          </div>
        </div>

        {/* 状态显示 - 毛笔信息条 */}
        <div className="mt-8 flex items-center gap-8 text-sm animate-slide-up-delay">
          <div className="flex items-center gap-3">
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
        <div className="flex flex-wrap justify-center gap-3 mt-8 animate-slide-up-delay-2">
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

        {/* 底部装饰诗句 */}
        <footer className="mt-12 text-center animate-fade-in-delay">
          <p className="text-sm text-ink-light opacity-60 font-light tracking-widest">
            笔落惊风雨，诗成泣鬼神
          </p>
        </footer>

        {/* 导出区域 */}
        <div className="mt-8 p-6 bg-paper-dark rounded-lg border border-wood-light">
          <h3 className="text-lg font-medium text-ink mb-4 text-center">导出 SVG</h3>

          {/* 导出配置 */}
          <div className="flex justify-center items-center gap-6 mb-6 p-3 bg-paper rounded-lg border border-wood-light">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={exportWithGrid}
                  onChange={(e) => setExportWithGrid(e.target.checked)}
                  className="w-4 h-4 accent-cinnabar"
                />
                <span className="text-sm text-ink font-medium">田字格</span>
              </label>
              {exportWithGrid && (
                <div className="flex items-center gap-1.5 ml-1 transition-all duration-300">
                  <input
                    type="color"
                    value={exportGridColor}
                    onChange={(e) => setExportGridColor(e.target.value)}
                    className="w-5 h-5 p-0 border border-wood-light rounded cursor-pointer bg-transparent overflow-hidden"
                    title="选择田字格颜色"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={exportWithGhost}
                  onChange={(e) => setExportWithGhost(e.target.checked)}
                  className="w-4 h-4 accent-cinnabar"
                />
                <span className="text-sm text-ink font-medium">Ghost 底字</span>
              </label>
              {exportWithGhost && (
                <div className="flex items-center gap-1.5 ml-1 transition-all duration-300">
                  <input
                    type="color"
                    value={exportGhostColor}
                    onChange={(e) => setExportGhostColor(e.target.value)}
                    className="w-5 h-5 p-0 border border-wood-light rounded cursor-pointer bg-transparent overflow-hidden"
                    title="选择Ghost底字颜色"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 笔划预览网格（与导出效果一致） */}
          <div className="flex flex-wrap justify-center gap-4 mb-6">
            {strokePaths.length > 0 && Array.from({ length: totalStrokes + 1 }, (_, i) => {
              const svgStr = buildStrokeSvg(strokePaths, i, getExportOpts())
              const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`
              return (
                <div key={`${char}-${i}-${exportWithGrid}-${exportWithGhost}-${exportGridColor}-${exportGhostColor}`} className="flex flex-col items-center gap-2">
                  <div className="relative">
                    <img
                      src={dataUrl}
                      width={80}
                      height={80}
                      alt={`${char} ${i}笔`}
                      className="w-20 h-20 bg-paper border border-wood-light rounded cursor-pointer hover:border-cinnabar transition-colors"
                    />
                    <button
                      onClick={() => downloadSingleStroke(i)}
                      className="absolute -bottom-1 -right-1 w-6 h-6 bg-jade text-white text-xs rounded-full flex items-center justify-center hover:bg-jade-light transition-colors shadow"
                    >
                      ↓
                    </button>
                  </div>
                  <span className="text-xs text-ink-light">{i}笔</span>
                </div>
              )
            })}
          </div>

          {/* 导出按钮 */}
          <div className="flex flex-wrap justify-center gap-4">
            <button
              onClick={exportAllStrokesZip}
              disabled={totalStrokes === 0}
              className="px-5 py-2.5 bg-cinnabar text-white text-sm rounded-lg hover:bg-cinnabar-light transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <span>📦</span> 导出累积笔划 ZIP
            </button>
            <button
              onClick={exportAllIndividualStrokesZip}
              disabled={totalStrokes === 0}
              className="px-5 py-2.5 bg-ink text-white text-sm rounded-lg hover:bg-ink-light transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <span>📦</span> 导出单独笔划 ZIP
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
