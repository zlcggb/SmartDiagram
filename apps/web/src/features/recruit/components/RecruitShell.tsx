import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react'
import gsap from 'gsap'
import { BarChart3, BrainCircuit, BriefcaseBusiness, CalendarClock, FilePenLine, LayoutDashboard, ScanSearch, Settings, UsersRound } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { prefersReducedMotion, usePageMotion } from '@/features/recruit/lib/motion'

import '../recruit.css'
import '../recruit-theme.css'

const NAV_ITEMS = [
  { to: '/recruit', label: '招聘首页', icon: LayoutDashboard },
  { to: '/recruit/screen', label: 'AI 找人才', icon: BrainCircuit },
  { to: '/recruit/jobs', label: '岗位中心', icon: BriefcaseBusiness },
  { to: '/recruit/candidates', label: '候选人', icon: UsersRound },
  { to: '/recruit/resume-lab', label: '简历优化', icon: FilePenLine },
  { to: '/recruit/interviews', label: '面试流程', icon: CalendarClock },
  { to: '/recruit/analytics', label: '统计分析', icon: BarChart3 },
  { to: '/recruit/settings', label: '设置', icon: Settings }
]

function moveIndicator(container: HTMLElement | null, axis: 'y' | 'x', immediate: boolean) {
  const indicator = container?.querySelector<HTMLElement>('.rx-nav-indicator')
  const active = container?.querySelector<HTMLElement>('.recruit-nav__link.active')
  if (!indicator || !container) return
  if (!active) {
    gsap.set(indicator, { autoAlpha: 0 })
    return
  }
  // offset* is relative to the positioned container's content, so it stays correct while scrolled.
  const width = active.offsetWidth
  const height = active.offsetHeight
  if (!width || !height) return
  const offsetX = active.offsetLeft
  const offsetY = active.offsetTop
  const vars = axis === 'y'
    ? { y: offsetY, height, x: 0, width }
    : { x: offsetX, width, y: offsetY, height }
  if (immediate || prefersReducedMotion()) gsap.set(indicator, { ...vars, autoAlpha: 1 })
  else gsap.to(indicator, { ...vars, autoAlpha: 1, duration: 0.55, ease: 'expo.out' })
}

export function RecruitShell() {
  const location = useLocation()
  const contentRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  usePageMotion(contentRef, location.pathname)

  useLayoutEffect(() => {
    const immediate = !mountedRef.current
    mountedRef.current = true
    moveIndicator(navRef.current, 'y', immediate)
    moveIndicator(mobileNavRef.current, 'x', immediate)
    const mobileNav = mobileNavRef.current
    const active = mobileNav?.querySelector<HTMLElement>('.recruit-nav__link.active')
    if (mobileNav && active && mobileNav.scrollWidth > mobileNav.clientWidth) {
      // Scroll only the nav itself; scrollIntoView would also scroll page ancestors.
      mobileNav.scrollTo({
        left: active.offsetLeft - (mobileNav.clientWidth - active.offsetWidth) / 2,
        behavior: immediate || prefersReducedMotion() ? 'auto' : 'smooth'
      })
    }
  }, [location.pathname])

  useEffect(() => {
    // Each nav is display:none on one side of the breakpoint, so re-measure after layout changes.
    const remeasure = () => {
      moveIndicator(navRef.current, 'y', true)
      moveIndicator(mobileNavRef.current, 'x', true)
    }
    const observer = new ResizeObserver(remeasure)
    if (navRef.current) observer.observe(navRef.current)
    if (mobileNavRef.current) observer.observe(mobileNavRef.current)
    document.fonts?.ready.then(remeasure)
    return () => observer.disconnect()
  }, [])

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.recruit-panel, .recruit-stat, .rx-spot')
    if (!card) return
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
    card.style.setProperty('--my', `${event.clientY - rect.top}px`)
  }

  return (
    <main className="recruit-shell h-full w-full">
      <div className="recruit-shell__layout">
        <aside className="recruit-sidebar">
          <Link to="/recruit" className="recruit-sidebar__brand">
            <span className="recruit-sidebar__brand-mark"><ScanSearch size={18} /></span>
            <span>
              <strong>Talent Atlas</strong>
              <em>AI 招聘工作台</em>
            </span>
          </Link>
          <nav ref={navRef} className="recruit-nav">
            <span className="rx-nav-indicator" aria-hidden="true" />
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/recruit'}
                  className="recruit-nav__link"
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  <em>{String(index + 1).padStart(2, '0')}</em>
                </NavLink>
              )
            })}
          </nav>
          <div className="rx-sidebar-card">
            <span className="rx-sidebar-card__pulse" aria-hidden="true" />
            <p>评估引擎 · rubric-v3</p>
            <strong>证据锚定评分</strong>
            <span>JD 生成评分卡 → 逐项 0-4 行为锚定 → 原文证据核验 → 代码计分。</span>
          </div>
        </aside>

        <section ref={contentRef} className="recruit-shell__content" onPointerMove={handlePointerMove}>
          <div ref={mobileNavRef} className="recruit-mobile-nav">
            <span className="rx-nav-indicator" aria-hidden="true" />
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/recruit'}
                  className="recruit-nav__link"
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </div>
          <Outlet />
        </section>
      </div>
    </main>
  )
}
