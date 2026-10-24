import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react'
import gsap from 'gsap'
import { BarChart3, BrainCircuit, BriefcaseBusiness, CalendarClock, FilePenLine, LayoutDashboard, LogIn, LogOut, ScanSearch, Settings, UserCheck, UsersRound } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { prefersReducedMotion, usePageMotion } from '@/features/recruit/lib/motion'
import { usePlatformAuth } from '@/shared/store/authStore'

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
  const session = usePlatformAuth((state) => state.session)
  const openLogin = usePlatformAuth((state) => state.openLogin)
  const logout = usePlatformAuth((state) => state.logout)
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
          <div
            style={{
              marginTop: '10px',
              padding: '10px 12px',
              borderRadius: '14px',
              background: session ? 'rgba(255, 255, 255, 0.06)' : 'rgba(216, 243, 102, 0.12)',
              border: session ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(216, 243, 102, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            {session ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'rgba(216, 243, 102, 0.2)',
                      color: '#d8f366',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <UserCheck size={14} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#f8fafc',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {session.user.display_name || session.user.email}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: 'rgba(248, 250, 252, 0.55)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      已登录 · 7天自动续期
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  title="退出登录并返回桌面"
                  style={{
                    flexShrink: 0,
                    padding: '6px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: 'none',
                    color: 'rgba(248, 250, 252, 0.75)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LogOut size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => openLogin()}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#d8f366' }}>
                    未登录（访客模式）
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'rgba(248, 250, 252, 0.7)', marginTop: '2px' }}>
                    点击登录以访问您的候选人库
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: '#d8f366',
                    color: '#111827',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <LogIn size={13} />
                  登录
                </span>
              </button>
            )}
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
