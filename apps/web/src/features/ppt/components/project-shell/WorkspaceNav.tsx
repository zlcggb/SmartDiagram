import { Link, useLocation } from "react-router-dom";
import { Clapperboard, LayoutGrid, PanelsTopLeft, MessageSquareText } from "lucide-react";
import { workspaceNavTarget } from "./workspaceNavigation";

const navItems = [
  { key: "intent", label: "意图", path: "intent", icon: MessageSquareText },
  { key: "structure", label: "结构", path: "structure", icon: LayoutGrid },
  { key: "studio", label: "工作室", path: "studio", icon: PanelsTopLeft },
  { key: "director", label: "导演", path: "director", icon: Clapperboard }
] as const;

export function WorkspaceNav({ projectId }: { projectId: string | undefined }) {
  const location = useLocation();
  const activeKey =
    (location.pathname.includes(`/p/${projectId}/exports`)
      ? "director"
      : navItems.find((item) => location.pathname.includes(`/p/${projectId}/${item.path}`))?.key) ?? "intent";

  return (
    <nav className="workspace-nav" aria-label="项目工作区导航">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            to={workspaceNavTarget(projectId, item.path)}
            className={`workspace-nav__item ${activeKey === item.key ? "is-active" : ""}`}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
