'use client'

import { useState, useRef, useEffect } from 'react'
import HanziWriter from 'hanzi-writer'

type AnimationState = 'idle' | 'playing' | 'paused' | 'complete'

export default function Home() {
  const [char, setChar] = useState('永')
  const [inputChar, setInputChar] = useState('永')
  const [state, setState] = useState<AnimationState>('idle')
  const [currentStroke, setCurrentStroke] = useState(0)
  const [totalStrokes, setTotalStrokes] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [isPaused, setIsPausedState] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  
  const writerRef = useRef<HanziWriter | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animatingRef = useRef(false)
  const loopRef = useRef(false)

  // 初始化汉字
  const loadChar = (newChar: string) => {
    if (!newChar.trim()) return
    
    setChar(newChar)
    setState('idle')
    setCurrentStroke(0)
    animatingRef.current = false
    setIsPausedState(false)
    setIsLoaded(false)
    
    // 清理旧的 writer
    if (writerRef.current) {
      writerRef.current = null
    }
    
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }
    
    // 创建新的 writer 实例 - 水墨风格
    const writer = HanziWriter.create(containerRef.current!, newChar, {
      width: 240,
      height: 240,
      padding: 20,
      showOutline: true,
      outlineColor: '#d4c5b0',
      strokeColor: '#1a1a1a',
      radicalColor: '#c41e3a',
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 600,
      showCharacter: false,
      renderer: 'svg'
    })
    
    writerRef.current = writer
    
    // 获取笔画数
    HanziWriter.loadCharacterData(newChar).then((data) => {
      if (data && 'strokes' in data) {
        setTotalStrokes(data.strokes.length)
        setIsLoaded(true)
      }
    })
  }

  // 处理输入
  const handleInput = () => {
    if (inputChar.trim()) {
      loadChar(inputChar.trim())
    }
  }

  // 开始动画
  const startAnimation = () => {
    if (!writerRef.current) return
    
    animatingRef.current = true
    setState('playing')
    
    writerRef.current.hideOutline()
    
    let strokeIndex = 0
    setCurrentStroke(strokeIndex)
    
    const animateNextStroke = () => {
      if (!animatingRef.current || isPaused || !writerRef.current) return
      
      if (strokeIndex < totalStrokes) {
        writerRef.current.animateStroke(strokeIndex, {
          onComplete: () => {
            strokeIndex++
            setCurrentStroke(strokeIndex)
            if (strokeIndex < totalStrokes && animatingRef.current && !isPaused) {
              setTimeout(animateNextStroke, 600)
            } else if (strokeIndex >= totalStrokes && animatingRef.current) {
              animationComplete()
            }
          }
        })
      }
    }
    
    animateNextStroke()
  }

  // 动画完成
  const animationComplete = () => {
    animatingRef.current = false
    setState('complete')
    
    if (loopRef.current) {
      setTimeout(() => {
        resetAndRestart()
        setTimeout(startAnimation, 300)
      }, 1500)
    }
  }

  // 暂停/继续
  const togglePause = () => {
    if (!writerRef.current) return
    
    if (isPaused) {
      writerRef.current.resumeAnimation()
      setIsPausedState(false)
      setState('playing')
    } else {
      writerRef.current.pauseAnimation()
      setIsPausedState(true)
      setState('paused')
    }
  }

  // 重置
  const resetAndRestart = () => {
    if (!writerRef.current) return
    
    animatingRef.current = false
    setIsPausedState(false)
    loopRef.current = false
    setIsLooping(false)
    
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

  // 初始化
  useEffect(() => {
    loadChar(char)
  }, [])

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
                <rect x="2" y="2" width="236" height="236" fill="none" stroke="#8b7355" strokeWidth="2" rx="4"/>
                {/* 米字格中心线 */}
                <line x1="0" y1="120" x2="240" y2="120" stroke="#c9b896" strokeWidth="1.5" strokeDasharray="8 6"/>
                <line x1="120" y1="0" x2="120" y2="240" stroke="#c9b896" strokeWidth="1.5" strokeDasharray="8 6"/>
                {/* 对角线 */}
                <line x1="0" y1="0" x2="240" y2="240" stroke="#d4c5b0" strokeWidth="1"/>
                <line x1="240" y1="0" x2="0" y2="240" stroke="#d4c5b0" strokeWidth="1"/>
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
                onChange={(e) => setInputChar(e.target.value.slice(-1))}
                onKeyDown={(e) => e.key === 'Enter' && handleInput()}
                placeholder="字"
                className="w-16 h-14 text-3xl text-center border-2 border-ink-light bg-transparent rounded-lg focus:border-cinnabar focus:outline-none transition-all placeholder:text-ink-light placeholder:opacity-40 font-calligraphy"
                maxLength={1}
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
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${
              state === 'idle' ? 'bg-ink-light opacity-50' : 
              state === 'playing' ? 'bg-cinnabar animate-pulse-gentle' : 
              state === 'paused' ? 'bg-amber-600' : 
              'bg-jade'
            }`} />
            <span className="text-ink-light font-light tracking-wide">
              {state === 'idle' ? '待命' : state === 'playing' ? '书写中' : state === 'paused' ? '已暂停' : '书毕'}
            </span>
          </div>
          
          <div className="text-ink-light font-light tracking-wider">
            <span className="opacity-70">笔画 </span>
            <span className="font-medium text-ink">{currentStroke}</span>
            <span className="opacity-50 mx-1">/</span>
            <span>{totalStrokes}</span>
          </div>
        </div>

        {/* 控制按钮组 - 印章风格 */}
        <div className="flex flex-wrap justify-center gap-3 mt-8 animate-slide-up-delay-2">
          <button
            onClick={state === 'playing' ? resetAndRestart : startAnimation}
            disabled={state === 'playing' || totalStrokes === 0}
            className="stamp-btn group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-xl">{state === 'playing' ? '↺' : '▶'}</span>
            <span className="relative">{state === 'playing' ? '重书' : '起笔'}</span>
          </button>

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
      </div>
    </div>
  )
}