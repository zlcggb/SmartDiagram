import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  activateSlideDesignVersion,
  clearSlideDesignVersions,
  listSlideDesignVersions,
  persistSlideDesignVersion
} from "./slideDesignVersions.js";

type FakeSlide = {
  id: string;
  projectId: string;
  svgPreview: string | null;
  activeDesignVersionId: string | null;
  generationStatus: string;
  renderStrategy: string | null;
  strategyLocked: boolean;
  slideSources: unknown[];
};

type FakeVersion = {
  id: string;
  slideId: string;
  svgPreview: string;
  source: string;
  theme: string | null;
  accentId: string | null;
  surfaceId: string | null;
  createdAt: Date;
};

function createFakePrisma() {
  const slides: FakeSlide[] = [
    {
      id: "slide-1",
      projectId: "project-1",
      svgPreview: null,
      activeDesignVersionId: null,
      generationStatus: "draft-ready",
      renderStrategy: null,
      strategyLocked: false,
      slideSources: []
    },
    {
      id: "slide-2",
      projectId: "project-2",
      svgPreview: null,
      activeDesignVersionId: null,
      generationStatus: "draft-ready",
      renderStrategy: null,
      strategyLocked: false,
      slideSources: []
    }
  ];
  let sequence = 0;
  let versions: FakeVersion[] = [];

  const tx = {
    slide: {
      async findFirst(args: { where: { id: string; projectId: string } }) {
        return slides.find((slide) => slide.id === args.where.id && slide.projectId === args.where.projectId) ?? null;
      },
      async update(args: { where: { id: string }; data: Partial<FakeSlide> }) {
        const slide = slides.find((item) => item.id === args.where.id);
        if (!slide) throw new Error("slide not found");
        Object.assign(slide, args.data);
        return { ...slide };
      }
    },
    slideDesignVersion: {
      async create(args: { data: Omit<FakeVersion, "id" | "createdAt"> }) {
        sequence += 1;
        const version: FakeVersion = {
          ...args.data,
          id: `version-${sequence}`,
          createdAt: new Date(`2026-07-26T00:00:${String(sequence).padStart(2, "0")}.000Z`)
        };
        versions.push(version);
        return { ...version };
      },
      async findFirst(args: { where: { id: string; slideId: string } }) {
        return versions.find(
          (version) => version.id === args.where.id && version.slideId === args.where.slideId
        ) ?? null;
      },
      async findMany(args: {
        where: { slideId: string };
        orderBy?: Array<Record<string, "asc" | "desc">>;
        skip?: number;
        select?: { id: true };
      }) {
        const direction = args.orderBy?.[0]?.createdAt ?? "asc";
        const ordered = versions
          .filter((version) => version.slideId === args.where.slideId)
          .sort((left, right) =>
            direction === "desc"
              ? right.createdAt.getTime() - left.createdAt.getTime()
              : left.createdAt.getTime() - right.createdAt.getTime()
          )
          .slice(args.skip ?? 0);
        return args.select ? ordered.map(({ id }) => ({ id })) : ordered.map((version) => ({ ...version }));
      },
      async deleteMany(args: { where: { slideId?: string; id?: { in: string[] } } }) {
        const before = versions.length;
        versions = versions.filter((version) => {
          if (args.where.slideId) return version.slideId !== args.where.slideId;
          if (args.where.id) return !args.where.id.in.includes(version.id);
          return true;
        });
        return { count: before - versions.length };
      }
    }
  };

  const client = {
    ...tx,
    async $transaction<T>(callback: (transaction: typeof tx) => Promise<T>) {
      return callback(tx);
    }
  } as unknown as PrismaClient;

  return {
    client,
    slides,
    get versions() {
      return versions;
    }
  };
}

const svg = (label: string) => `<svg viewBox="0 0 1280 720"><text>${label}</text></svg>`;

test("新版本成为活跃版本并同步当前 SVG", async () => {
  const fake = createFakePrisma();
  const slide = await persistSlideDesignVersion(
    {
      projectId: "project-1",
      slideId: "slide-1",
      svgPreview: svg("A"),
      source: "ai",
      theme: "light"
    },
    fake.client
  );

  assert.equal(slide.activeDesignVersionId, "version-1");
  assert.equal(slide.svgPreview, svg("A"));
  assert.equal(fake.versions.length, 1);
});

test("连续保存六次只保留最近五次", async () => {
  const fake = createFakePrisma();
  for (let index = 1; index <= 6; index += 1) {
    await persistSlideDesignVersion(
      {
        projectId: "project-1",
        slideId: "slide-1",
        svgPreview: svg(String(index)),
        source: "ai"
      },
      fake.client
    );
  }

  assert.deepEqual(fake.versions.map((version) => version.id), [
    "version-2",
    "version-3",
    "version-4",
    "version-5",
    "version-6"
  ]);
  assert.equal(fake.slides[0]?.activeDesignVersionId, "version-6");
});

test("相同 SVG 不创建重复版本但仍应用页面补丁", async () => {
  const fake = createFakePrisma();
  await persistSlideDesignVersion(
    {
      projectId: "project-1",
      slideId: "slide-1",
      svgPreview: svg("same"),
      source: "manual"
    },
    fake.client
  );
  await persistSlideDesignVersion(
    {
      projectId: "project-1",
      slideId: "slide-1",
      svgPreview: svg("same"),
      source: "manual",
      slidePatch: { generationStatus: "svg-ready" }
    },
    fake.client
  );

  assert.equal(fake.versions.length, 1);
  assert.equal(fake.slides[0]?.generationStatus, "svg-ready");
});

test("激活旧版本会同步 Slide.svgPreview", async () => {
  const fake = createFakePrisma();
  await persistSlideDesignVersion(
    { projectId: "project-1", slideId: "slide-1", svgPreview: svg("old"), source: "ai" },
    fake.client
  );
  await persistSlideDesignVersion(
    { projectId: "project-1", slideId: "slide-1", svgPreview: svg("new"), source: "ai" },
    fake.client
  );

  const slide = await activateSlideDesignVersion(
    "project-1",
    "slide-1",
    "version-1",
    fake.client
  );

  assert.equal(slide.activeDesignVersionId, "version-1");
  assert.equal(slide.svgPreview, svg("old"));
});

test("不能激活其他项目页面的版本", async () => {
  const fake = createFakePrisma();
  await persistSlideDesignVersion(
    { projectId: "project-2", slideId: "slide-2", svgPreview: svg("foreign"), source: "ai" },
    fake.client
  );

  await assert.rejects(
    activateSlideDesignVersion("project-1", "slide-1", "version-1", fake.client),
    /设计版本/
  );
});

test("列表按旧到新返回并标记活跃版本", async () => {
  const fake = createFakePrisma();
  await persistSlideDesignVersion(
    { projectId: "project-1", slideId: "slide-1", svgPreview: svg("old"), source: "ai" },
    fake.client
  );
  await persistSlideDesignVersion(
    { projectId: "project-1", slideId: "slide-1", svgPreview: svg("new"), source: "manual" },
    fake.client
  );

  const history = await listSlideDesignVersions("project-1", "slide-1", fake.client);

  assert.equal(history.activeVersionId, "version-2");
  assert.deepEqual(history.versions.map((version) => version.id), ["version-1", "version-2"]);
  assert.equal(history.versions[1]?.source, "manual");
});

test("清空设计会删除历史并清除当前版本", async () => {
  const fake = createFakePrisma();
  await persistSlideDesignVersion(
    { projectId: "project-1", slideId: "slide-1", svgPreview: svg("old"), source: "ai" },
    fake.client
  );

  const slide = await clearSlideDesignVersions(
    "project-1",
    "slide-1",
    { generationStatus: "draft-ready" },
    fake.client
  );

  assert.equal(fake.versions.length, 0);
  assert.equal(slide.activeDesignVersionId, null);
  assert.equal(slide.svgPreview, null);
  assert.equal(slide.generationStatus, "draft-ready");
});
