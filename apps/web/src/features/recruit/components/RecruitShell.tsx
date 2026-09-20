import { BarChart3, BriefcaseBusiness, LayoutDashboard, UsersRound } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/recruit', label: '招聘首页', icon: LayoutDashboard },
  { to: '/recruit/jobs', label: '岗位中心', icon: BriefcaseBusiness },
  { to: '/recruit/candidates', label: '候选人', icon: UsersRound },
  { to: '/recruit/interviews', label: '面试流程', icon: UsersRound },
  { to: '/recruit/analytics', label: '统计分析', icon: BarChart3 }
]

export function RecruitShell() {
  return (
    <main className="flex h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.18),_rgba(15,23,42,0.92)_45%)] text-slate-100">
      <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-slate-950/65 p-6 lg:flex lg:flex-col">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">Recruiting ATS</p>
          <h1 className="mt-3 text-2xl font-semibold text-white">AI 招聘子系统</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            基于当前 SmartDiagram 架构原生落地的岗位管理、候选人跟踪、AI 初筛、面试记录与统计分析工作台。
          </p>
        </div>
        <nav className="mt-8 space-y-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/recruit'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition ${
                    isActive ? 'bg-cyan-400/15 text-white' : 'text-slate-300 hover:bg-white/5'
                  }`
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>

      <section className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-white/8 bg-slate-950/40 px-4 py-4 backdrop-blur md:px-6 lg:hidden">
          <div className="flex gap-2 overflow-auto">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/recruit'}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm whitespace-nowrap ${isActive ? 'bg-cyan-400/20 text-white' : 'bg-white/5 text-slate-300'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
        <Outlet />
      </section>
    </main>
  )
}
