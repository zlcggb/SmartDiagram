import { BarChart3, BrainCircuit, BriefcaseBusiness, LayoutDashboard, UsersRound } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import '../recruit.css'

const NAV_ITEMS = [
  { to: '/recruit', label: '招聘首页', icon: LayoutDashboard },
  { to: '/recruit/screen', label: 'AI 找人才', icon: BrainCircuit },
  { to: '/recruit/jobs', label: '岗位中心', icon: BriefcaseBusiness },
  { to: '/recruit/candidates', label: '候选人', icon: UsersRound },
  { to: '/recruit/interviews', label: '面试流程', icon: UsersRound },
  { to: '/recruit/analytics', label: '统计分析', icon: BarChart3 }
]

export function RecruitShell() {
  return (
    <main className="recruit-shell h-full w-full">
      <div className="recruit-shell__layout">
        <aside className="recruit-sidebar">
          <Link to="/recruit" className="recruit-sidebar__brand">
            <span className="recruit-sidebar__brand-mark"><BriefcaseBusiness size={17} /></span>
            <span>
              <strong>招聘</strong>
              <em>人才工作台</em>
            </span>
          </Link>
          <nav className="recruit-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/recruit'}
                className="recruit-nav__link"
              >
                {() => (
                  <>
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
          </nav>
        </aside>

        <section className="recruit-shell__content">
          <div className="recruit-mobile-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/recruit'}
                className="recruit-nav__link"
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <Outlet />
        </section>
      </div>
    </main>
  )
}
