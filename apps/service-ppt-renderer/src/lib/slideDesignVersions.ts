import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isPresentationStyleId,
  slideDesignVersionSourceSchema,
  type SlideDesignHistoryDto,
  type SlideDesignVersionDto,
  type SlideDesignVersionSource
} from "@ppt-agent/shared";
import { prisma } from "./prisma.js";

const DESIGN_VERSION_LIMIT = 5;

type SlideWithSources = Prisma.SlideGetPayload<{ include: { slideSources: true } }>;

export class SlideDesignVersionNotFoundError extends Error {
  constructor(entity: "slide" | "version") {
    super(entity === "slide" ? "未找到页面" : "未找到该页面的设计版本");
    this.name = "SlideDesignVersionNotFoundError";
  }
}

function formatDesignVersion(version: {
  id: string;
  slideId: string;
  svgPreview: string;
  source: string;
  theme: string | null;
  accentId: string | null;
  surfaceId: string | null;
  presentationStyle: string | null;
  createdAt: Date;
}): SlideDesignVersionDto {
  return {
    id: version.id,
    slideId: version.slideId,
    svgPreview: version.svgPreview,
    source: slideDesignVersionSourceSchema.parse(version.source),
    theme: version.theme,
    accentId: version.accentId,
    surfaceId: version.surfaceId,
    presentationStyle: isPresentationStyleId(version.presentationStyle)
      ? version.presentationStyle
      : null,
    createdAt: version.createdAt.toISOString()
  };
}

export async function persistSlideDesignVersion(
  input: {
    projectId: string;
    slideId: string;
    svgPreview: string;
    source: SlideDesignVersionSource;
    theme?: string | null;
    accentId?: string | null;
    surfaceId?: string | null;
    presentationStyle?: string | null;
    slidePatch?: Prisma.SlideUncheckedUpdateInput;
  },
  client: PrismaClient = prisma
): Promise<SlideWithSources> {
  return client.$transaction(async (tx) => {
    const existing = await tx.slide.findFirst({
      where: { id: input.slideId, projectId: input.projectId },
      include: { slideSources: true }
    });
    if (!existing) throw new SlideDesignVersionNotFoundError("slide");

    if (
      existing.activeDesignVersionId &&
      existing.svgPreview === input.svgPreview
    ) {
      return tx.slide.update({
        where: { id: existing.id },
        data: {
          ...input.slidePatch,
          svgPreview: input.svgPreview
        },
        include: { slideSources: true }
      });
    }

    const version = await tx.slideDesignVersion.create({
      data: {
        slideId: existing.id,
        svgPreview: input.svgPreview,
        source: input.source,
        theme: input.theme ?? null,
        accentId: input.accentId ?? null,
        surfaceId: input.surfaceId ?? null,
        presentationStyle: input.presentationStyle ?? null
      }
    });

    const updated = await tx.slide.update({
      where: { id: existing.id },
      data: {
        ...input.slidePatch,
        svgPreview: input.svgPreview,
        activeDesignVersionId: version.id
      },
      include: { slideSources: true }
    });

    const stale = await tx.slideDesignVersion.findMany({
      where: { slideId: existing.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: DESIGN_VERSION_LIMIT,
      select: { id: true }
    });
    if (stale.length > 0) {
      await tx.slideDesignVersion.deleteMany({
        where: { id: { in: stale.map(({ id }) => id) } }
      });
    }

    return updated;
  });
}

export async function listSlideDesignVersions(
  projectId: string,
  slideId: string,
  client: PrismaClient = prisma
): Promise<SlideDesignHistoryDto> {
  const slide = await client.slide.findFirst({
    where: { id: slideId, projectId },
    select: { activeDesignVersionId: true }
  });
  if (!slide) throw new SlideDesignVersionNotFoundError("slide");

  const versions = (
    await client.slideDesignVersion.findMany({
      where: { slideId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: DESIGN_VERSION_LIMIT
    })
  ).reverse();
  return {
    activeVersionId: slide.activeDesignVersionId,
    versions: versions.map(formatDesignVersion)
  };
}

export async function activateSlideDesignVersion(
  projectId: string,
  slideId: string,
  versionId: string,
  client: PrismaClient = prisma
): Promise<SlideWithSources> {
  return client.$transaction(async (tx) => {
    const slide = await tx.slide.findFirst({
      where: { id: slideId, projectId },
      include: { slideSources: true }
    });
    if (!slide) throw new SlideDesignVersionNotFoundError("slide");

    const version = await tx.slideDesignVersion.findFirst({
      where: { id: versionId, slideId }
    });
    if (!version) throw new SlideDesignVersionNotFoundError("version");

    return tx.slide.update({
      where: { id: slideId },
      data: {
        activeDesignVersionId: version.id,
        svgPreview: version.svgPreview,
        generationStatus: "svg-ready",
        renderStrategy: "svg",
        strategyLocked: false
      },
      include: { slideSources: true }
    });
  });
}

export async function clearSlideDesignVersions(
  projectId: string,
  slideId: string,
  slidePatch: Prisma.SlideUncheckedUpdateInput = {},
  client: PrismaClient = prisma
): Promise<SlideWithSources> {
  return client.$transaction(async (tx) => {
    const slide = await tx.slide.findFirst({
      where: { id: slideId, projectId },
      include: { slideSources: true }
    });
    if (!slide) throw new SlideDesignVersionNotFoundError("slide");

    const updated = await tx.slide.update({
      where: { id: slideId },
      data: {
        ...slidePatch,
        svgPreview: null,
        activeDesignVersionId: null
      },
      include: { slideSources: true }
    });
    await tx.slideDesignVersion.deleteMany({ where: { slideId } });
    return updated;
  });
}
