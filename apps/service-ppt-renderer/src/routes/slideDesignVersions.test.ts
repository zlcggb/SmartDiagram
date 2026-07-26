import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSlideDesignVersionRoutes } from "./slideDesignVersions.js";

test("历史接口返回当前页面的版本列表", async () => {
  const app = Fastify();
  await app.register(
    createSlideDesignVersionRoutes({
      async list(projectId, slideId) {
        assert.equal(projectId, "project-1");
        assert.equal(slideId, "slide-1");
        return {
          activeVersionId: "version-2",
          versions: [
            {
              id: "version-2",
              slideId,
              svgPreview: "<svg />",
              source: "ai",
              theme: null,
              accentId: null,
              surfaceId: null,
              createdAt: "2026-07-26T00:00:00.000Z"
            }
          ]
        };
      },
      async activate() {
        throw new Error("not used");
      }
    })
  );

  const response = await app.inject({
    method: "GET",
    url: "/api/projects/project-1/slides/slide-1/design-versions"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.activeVersionId, "version-2");
  await app.close();
});

test("激活接口透传项目、页面和版本三重标识", async () => {
  const app = Fastify();
  await app.register(
    createSlideDesignVersionRoutes({
      async list() {
        throw new Error("not used");
      },
      async activate(projectId, slideId, versionId) {
        assert.deepEqual([projectId, slideId, versionId], [
          "project-1",
          "slide-1",
          "version-1"
        ]);
        return { id: slideId, activeDesignVersionId: versionId };
      }
    })
  );

  const response = await app.inject({
    method: "PATCH",
    url: "/api/projects/project-1/slides/slide-1/design-versions/version-1/activate"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.activeDesignVersionId, "version-1");
  await app.close();
});

test("不存在的页面或版本返回 404", async () => {
  const app = Fastify();
  await app.register(
    createSlideDesignVersionRoutes({
      async list() {
        throw new Error("not used");
      },
      async activate() {
        const error = new Error("未找到该页面的设计版本");
        error.name = "SlideDesignVersionNotFoundError";
        throw error;
      }
    })
  );

  const response = await app.inject({
    method: "PATCH",
    url: "/api/projects/project-1/slides/slide-1/design-versions/missing/activate"
  });

  assert.equal(response.statusCode, 404);
  assert.match(response.json().message, /设计版本/);
  await app.close();
});
