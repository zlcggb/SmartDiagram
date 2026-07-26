import type {
  SlideDesignHistoryDto,
  SlideDesignVersionDto
} from "@ppt-agent/shared";

export function activeDesignVersionIndex(
  versions: SlideDesignVersionDto[],
  activeVersionId: string | null
) {
  if (!activeVersionId) return -1;
  return versions.findIndex((version) => version.id === activeVersionId);
}

export function normalizeSlideDesignHistory(
  history: SlideDesignHistoryDto,
  slideId: string
): SlideDesignHistoryDto {
  const versions = history.versions
    .filter((version) => version.slideId === slideId)
    .sort((left, right) => {
      const timeDifference =
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return timeDifference || left.id.localeCompare(right.id);
    });
  return {
    activeVersionId: versions.some(
      (version) => version.id === history.activeVersionId
    )
      ? history.activeVersionId
      : null,
    versions
  };
}
