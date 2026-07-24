import type { ProjectDetailDto, ProjectDto } from "../shared/index.ts";

const DATABASE_NAME = "smartdiagram-ppt-guest";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";

export interface GuestProjectRecord {
  projectId: string;
  updatedAt: string;
  detail: ProjectDetailDto;
}

export interface GuestProjectStorage {
  get(projectId: string): Promise<GuestProjectRecord | null>;
  getAll(): Promise<GuestProjectRecord[]>;
  put(record: GuestProjectRecord): Promise<void>;
  delete(projectId: string): Promise<void>;
}

function openGuestDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "projectId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("访客项目数据库打开失败"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("访客项目数据库操作失败"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("访客项目数据库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("访客项目数据库事务已取消"));
  });
}

function indexedDbStorage(): GuestProjectStorage {
  return {
    async get(projectId) {
      const database = await openGuestDatabase();
      try {
        const transaction = database.transaction(PROJECT_STORE, "readonly");
        const result = await requestResult(
          transaction.objectStore(PROJECT_STORE).get(projectId) as IDBRequest<GuestProjectRecord | undefined>
        );
        return result ?? null;
      } finally {
        database.close();
      }
    },
    async getAll() {
      const database = await openGuestDatabase();
      try {
        const transaction = database.transaction(PROJECT_STORE, "readonly");
        return await requestResult(
          transaction.objectStore(PROJECT_STORE).getAll() as IDBRequest<GuestProjectRecord[]>
        );
      } finally {
        database.close();
      }
    },
    async put(record) {
      const database = await openGuestDatabase();
      try {
        const transaction = database.transaction(PROJECT_STORE, "readwrite");
        transaction.objectStore(PROJECT_STORE).put(record);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
    async delete(projectId) {
      const database = await openGuestDatabase();
      try {
        const transaction = database.transaction(PROJECT_STORE, "readwrite");
        transaction.objectStore(PROJECT_STORE).delete(projectId);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    }
  };
}

export function createGuestProjectRepository(storage: GuestProjectStorage = indexedDbStorage()) {
  return {
    async save(detail: ProjectDetailDto) {
      await storage.put({
        projectId: detail.project.id,
        updatedAt: detail.project.updatedAt,
        detail
      });
    },
    async get(projectId: string) {
      return (await storage.get(projectId))?.detail ?? null;
    },
    async list(): Promise<ProjectDto[]> {
      const records = await storage.getAll();
      return records
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .map((record) => record.detail.project);
    },
    async remove(projectId: string) {
      await storage.delete(projectId);
    }
  };
}

export const guestProjectRepository = createGuestProjectRepository();

