/**
 * Product artwork shared by the desktop, Dock, Spotlight, and shell windows.
 *
 * Each runtime image is a 384 px export of an original 1024 px layered asset.
 * Keeping one component API prevents the same module from drifting across surfaces.
 */
import deepDiagramHomeIcon from "../../assets/macos-icons/deepdiagram-home-384.png";
import mindmapIcon from "../../assets/macos-icons/mindmap-384.png";
import presentationIcon from "../../assets/macos-icons/presentation-384.png";
import recentFolderIcon from "../../assets/macos-icons/recent-folder-384.png";

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
  return <ArtworkImage src={deepDiagramHomeIcon} size={size} />;
}

export function MindmapAppIcon({ size = 60 }: IconProps) {
  return <ArtworkImage src={mindmapIcon} size={size} />;
}

export function SlidesAppIcon({ size = 60 }: IconProps) {
  return <ArtworkImage src={presentationIcon} size={size} />;
}

export function FolderIcon({ size = 60 }: IconProps) {
  return <ArtworkImage src={recentFolderIcon} size={size} />;
}
