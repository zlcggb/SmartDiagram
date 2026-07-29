import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isPresentationStyleId,
  renderStrategies,
  SlideIrSchema,
  slideDesignVersionSourceSchema,
  type RenderStrategy,
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
  irJson: string | null;
  renderStrategy: string;
  createdAt: Date;
}): SlideDesignVersionDto {
  return {
    id: version.id,
    slideId: version.slideId,
    svgPreview: version.svgPreview,
    irJson: version.irJson ? SlideIrSchema.parse(JSON.parse(version.irJson)) : null,
    renderStrategy: (renderStrategies as readonly string[]).includes(version.renderStrategy)
      ? (version.renderStrategy as RenderStrategy)
      : "svg",
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
    irJson?: string | null;
    renderStrategy?: RenderStrategy;
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
      existing.svgPreview === input.svgPreview &&
      existing.irJson === (input.irJson ?? null) &&
      existing.renderStrategy === (input.renderStrategy ?? "svg")
    ) {
      return tx.slide.update({
        where: { id: existing.id },
        data: {
          ...input.slidePatch,
          svgPreview: input.svgPreview,
          irJson: input.irJson ?? null,
          renderStrategy: input.renderStrategy ?? "svg"
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
        presentationStyle: input.presentationStyle ?? null,
        irJson: input.irJson ?? null,
        renderStrategy: input.renderStrategy ?? "svg"
      }
    });

    const updated = await tx.slide.update({
      where: { id: existing.id },
      data: {
        ...input.slidePatch,
        svgPreview: input.svgPreview,
        irJson: input.irJson ?? null,
        renderStrategy: input.renderStrategy ?? "svg",
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
    const renderStrategy = version.renderStrategy === "ir" ? "ir" : "svg";

    return tx.slide.update({
      where: { id: slideId },
      data: {
        activeDesignVersionId: version.id,
        svgPreview: version.svgPreview,
        irJson: renderStrategy === "ir" ? version.irJson : null,
        generationStatus: renderStrategy === "ir" ? "ir-ready" : "svg-ready",
        renderStrategy,
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
        irJson: null,
        activeDesignVersionId: null
      },
      include: { slideSources: true }
    });
    await tx.slideDesignVersion.deleteMany({ where: { slideId } });
    return updated;
  });
}
