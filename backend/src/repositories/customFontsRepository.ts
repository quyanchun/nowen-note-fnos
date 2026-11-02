/**
 * Custom Fonts Repository
 *
 * 职责：
 * - 封装 custom_fonts 表的所有数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 * - 支持 adapter 注入（PG-PILOT-02 双库试点）
 */

import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";
import type { DatabaseAdapter } from "../db/adapters/types";
import type { CustomFont } from "./types";

/** 创建轻量 adapter 实例（每次调用新建，无全局生命周期） */
function getAdapter() {
  return new SqliteAdapter(getDb());
}

/**
 * 创建 customFontsRepository 实例。
 *
 * 默认使用 SQLite adapter。测试中可注入 PostgresAdapter 进行双库验证。
 *
 * @param adapter 数据库适配器（默认 SQLite）
 * @param nowExpr 当前时间表达式（SQLite: datetime('now'), PostgreSQL: NOW()）
 */
export function createCustomFontsRepository(
  adapter: DatabaseAdapter = getAdapter(),
  nowExpr = "datetime('now')",
) {
  return {
    // ---- 同步方法（仅 SQLite） ----

    /**
     * 获取所有字体
     */
    getAll(): CustomFont[] {
      const db = getDb();
      return db
        .prepare(
          'SELECT id, name, "fileName", format, "fileSize", "createdAt" FROM custom_fonts ORDER BY "createdAt" DESC',
        )
        .all() as CustomFont[];
    },

    /**
     * 获取字体列表（不含 fileSize，兼容旧 API）
     */
    getList(): Array<Omit<CustomFont, "fileSize">> {
      const db = getDb();
      return db
        .prepare(
          'SELECT id, name, "fileName", format, "createdAt" FROM custom_fonts ORDER BY "createdAt" DESC',
        )
        .all() as Array<Omit<CustomFont, "fileSize">>;
    },

    /**
     * 根据 ID 获取字体
     */
    getById(id: string): CustomFont | undefined {
      const db = getDb();
      return db
        .prepare(
          'SELECT id, name, "fileName", format, "fileSize", "createdAt" FROM custom_fonts WHERE id = ?',
        )
        .get(id) as CustomFont | undefined;
    },

    /**
     * 根据 ID 获取字体（精简版，用于文件下载）
     */
    getByIdForDownload(
      id: string,
    ): Pick<CustomFont, "id" | "fileName" | "format"> | undefined {
      const db = getDb();
      return db
        .prepare('SELECT id, "fileName", format FROM custom_fonts WHERE id = ?')
        .get(id) as Pick<CustomFont, "id" | "fileName" | "format"> | undefined;
    },

    /**
     * 根据文件名获取字体
     */
    getByFileName(fileName: string): CustomFont | undefined {
      const db = getDb();
      return db
        .prepare(
          'SELECT id, name, "fileName", format, "fileSize", "createdAt" FROM custom_fonts WHERE "fileName" = ?',
        )
        .get(fileName) as CustomFont | undefined;
    },

    /**
     * 根据文件名获取字体 ID（用于存在性检查）
     */
    getIdByFileName(fileName: string): string | undefined {
      const db = getDb();
      const row = db
        .prepare('SELECT id FROM custom_fonts WHERE "fileName" = ?')
        .get(fileName) as { id: string } | undefined;
      return row?.id;
    },

    /**
     * 创建字体
     */
    create(
      font: Omit<CustomFont, "createdAt"> & { createdAt?: string },
    ): void {
      const db = getDb();
      db.prepare(
        `INSERT INTO custom_fonts (id, name, "fileName", format, "fileSize", "createdAt")
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      ).run(font.id, font.name, font.fileName, font.format, font.fileSize);
    },

    /**
     * 删除字体
     */
    delete(id: string): void {
      const db = getDb();
      db.prepare("DELETE FROM custom_fonts WHERE id = ?").run(id);
    },

    /**
     * 检查文件名是否存在
     */
    existsByFileName(fileName: string): boolean {
      const db = getDb();
      const result = db
        .prepare('SELECT 1 FROM custom_fonts WHERE "fileName" = ? LIMIT 1')
        .get(fileName);
      return !!result;
    },

    // ---- Async 方法（支持 adapter 注入） ----

    /** 获取所有字体（async） */
    async getAllAsync(): Promise<CustomFont[]> {
      return adapter.queryMany<CustomFont>(
        'SELECT id, name, "fileName", format, "fileSize", "createdAt" FROM custom_fonts ORDER BY "createdAt" DESC',
      );
    },

    /** 获取字体列表（async，不含 fileSize） */
    async getListAsync(): Promise<Array<Omit<CustomFont, "fileSize">>> {
      return adapter.queryMany<Omit<CustomFont, "fileSize">>(
        'SELECT id, name, "fileName", format, "createdAt" FROM custom_fonts ORDER BY "createdAt" DESC',
      );
    },

    /** 根据 ID 获取字体（async） */
    async getByIdAsync(id: string): Promise<CustomFont | undefined> {
      return adapter.queryOne<CustomFont>(
        'SELECT id, name, "fileName", format, "fileSize", "createdAt" FROM custom_fonts WHERE id = ?',
        [id],
      );
    },

    /** 根据 ID 获取字体精简版（async，用于文件下载） */
    async getByIdForDownloadAsync(
      id: string,
    ): Promise<Pick<CustomFont, "id" | "fileName" | "format"> | undefined> {
      return adapter.queryOne<Pick<CustomFont, "id" | "fileName" | "format">>(
        'SELECT id, "fileName", format FROM custom_fonts WHERE id = ?',
        [id],
      );
    },

    /** 根据文件名获取字体（async） */
    async getByFileNameAsync(fileName: string): Promise<CustomFont | undefined> {
      return adapter.queryOne<CustomFont>(
        'SELECT id, name, "fileName", format, "fileSize", "createdAt" FROM custom_fonts WHERE "fileName" = ?',
        [fileName],
      );
    },

    /** 根据文件名获取字体 ID（async） */
    async getIdByFileNameAsync(fileName: string): Promise<string | undefined> {
      const row = await adapter.queryOne<{ id: string }>(
        'SELECT id FROM custom_fonts WHERE "fileName" = ?',
        [fileName],
      );
      return row?.id;
    },

    /** 创建字体（async） */
    async createAsync(
      font: Omit<CustomFont, "createdAt"> & { createdAt?: string },
    ): Promise<void> {
      await adapter.execute(
        `INSERT INTO custom_fonts (id, name, "fileName", format, "fileSize", "createdAt")
         VALUES (?, ?, ?, ?, ?, ${nowExpr})`,
        [font.id, font.name, font.fileName, font.format, font.fileSize],
      );
    },

    /** 删除字体（async） */
    async deleteAsync(id: string): Promise<void> {
      await adapter.execute(
        "DELETE FROM custom_fonts WHERE id = ?",
        [id],
      );
    },

    /** 检查文件名是否存在（async） */
    async existsByFileNameAsync(fileName: string): Promise<boolean> {
      const result = await adapter.queryOne<{ id: string }>(
        'SELECT 1 FROM custom_fonts WHERE "fileName" = ? LIMIT 1',
        [fileName],
      );
      return !!result;
    },
  };
}

/** 默认实例（SQLite，保持向后兼容） */
export const customFontsRepository = createCustomFontsRepository();
