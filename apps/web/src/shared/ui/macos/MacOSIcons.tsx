/**
 * Product artwork shared by the desktop, Dock, Spotlight, and shell windows.
 *
 * Artwork can be vector or raster, while the shared component API prevents the
 * same module from drifting across surfaces and output sizes.
 */
import { Building2, UsersRound } from "lucide-react";
import smartDiagramHomeIcon from '@/assets/macos-icons/smartdiagram-home.svg';
import recentFolderIcon from '@/assets/macos-icons/recent-folder-384.png';
import { PptAgentIconMark, SmartDiagramIconMark } from '@/components/brand/AppIconMarks';

interface IconProps {
  size?: number;
}

function ArtworkImage({ src, size }: { src: string; size: number }) {
  return (
    <img
      className="mac-artwork-image"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** The legacy export name remains stable for shell callers. */
export function FinderIcon({ size = 60 }: IconProps) {
  return <ArtworkImage src={smartDiagramHomeIcon} size={size} />;
}

export function MindmapAppIcon({ size = 60 }: IconProps) {
  return <SmartDiagramIconMark className="mac-artwork-image" size={size} />;
}

export function SlidesAppIcon({ size = 60 }: IconProps) {
  return <PptAgentIconMark className="mac-artwork-image" size={size} />;
}

export function RecruitAppIcon({ size = 60 }: IconProps) {
  const iconSize = Math.round(size * 0.42);
  return (
    <span
      className="mac-artwork-image mac-artwork-image--platform-admin"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <UsersRound size={iconSize} strokeWidth={2.1} />
    </span>
  );
}

export function FolderIcon({ size = 60 }: IconProps) {
  return <ArtworkImage src={recentFolderIcon} size={size} />;
}

export function PlatformAdminAppIcon({ size = 60 }: IconProps) {
  const iconSize = Math.round(size * 0.42);
  return (
    <span
      className="mac-artwork-image mac-artwork-image--platform-admin"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Building2 size={iconSize} strokeWidth={2.1} />
    </span>
  );
}
