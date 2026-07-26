import {
  resolvePresentationStyleId,
  type PresentationStyleId,
  type SlideDesignVersionDto
} from "@ppt-agent/shared";

export function resolveAppliedPageStyle({
  slideId,
  loadedSlideId,
  activeVersionId,
  versions,
  fallbackStyle
}: {
  slideId: string;
  loadedSlideId: string | null;
  activeVersionId: string | null;
  versions: SlideDesignVersionDto[];
  fallbackStyle: PresentationStyleId;
}): PresentationStyleId {
  if (loadedSlideId !== slideId || !activeVersionId) return fallbackStyle;
  return (
    versions.find((version) => version.id === activeVersionId)?.presentationStyle ??
    fallbackStyle
  );
}

export function styleSelectionNeedsRegeneration(
  projectStyle: PresentationStyleId,
  appliedStyle: PresentationStyleId,
  requestedConfiguredStyle: PresentationStyleId | null
) {
  return (
    resolvePresentationStyleId(projectStyle, requestedConfiguredStyle) !==
    appliedStyle
  );
}
