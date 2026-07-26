import type { FastifyInstance } from "fastify";
import type { SlideDesignHistoryDto } from "@ppt-agent/shared";
import {
  activateSlideDesignVersion,
  listSlideDesignVersions,
  SlideDesignVersionNotFoundError
} from "../lib/slideDesignVersions.js";
import { formatSlide } from "../lib/format.js";
import { fail, ok } from "../lib/response.js";

type VersionParams = {
  id: string;
  slideId: string;
  versionId: string;
};

export interface SlideDesignVersionRouteService {
  list(projectId: string, slideId: string): Promise<SlideDesignHistoryDto>;
  activate(projectId: string, slideId: string, versionId: string): Promise<unknown>;
}

const defaultService: SlideDesignVersionRouteService = {
  list: listSlideDesignVersions,
  async activate(projectId, slideId, versionId) {
    return formatSlide(
      await activateSlideDesignVersion(projectId, slideId, versionId)
    );
  }
};

function isNotFound(error: unknown) {
  return (
    error instanceof SlideDesignVersionNotFoundError ||
    (error instanceof Error && error.name === "SlideDesignVersionNotFoundError")
  );
}

export function createSlideDesignVersionRoutes(
  service: SlideDesignVersionRouteService = defaultService
) {
  return async function slideDesignVersionRoutes(app: FastifyInstance) {
    app.get<{ Params: Omit<VersionParams, "versionId"> }>(
      "/api/projects/:id/slides/:slideId/design-versions",
      async (request, reply) => {
        try {
          const history = await service.list(
            request.params.id,
            request.params.slideId
          );
          return reply.send(ok(history, "设计版本已加载"));
        } catch (error) {
          if (isNotFound(error)) {
            return reply
              .status(404)
              .send(fail(error instanceof Error ? error.message : "未找到页面"));
          }
          throw error;
        }
      }
    );

    app.patch<{ Params: VersionParams }>(
      "/api/projects/:id/slides/:slideId/design-versions/:versionId/activate",
      async (request, reply) => {
        try {
          const slide = await service.activate(
            request.params.id,
            request.params.slideId,
            request.params.versionId
          );
          return reply.send(ok(slide, "当前设计版本已切换"));
        } catch (error) {
          if (isNotFound(error)) {
            return reply
              .status(404)
              .send(
                fail(
                  error instanceof Error
                    ? error.message
                    : "未找到该页面的设计版本"
                )
              );
          }
          throw error;
        }
      }
    );
  };
}

export const slideDesignVersionRoutes = createSlideDesignVersionRoutes();
