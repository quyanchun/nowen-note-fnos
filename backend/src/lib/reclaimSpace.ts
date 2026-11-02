import type Database from "better-sqlite3";

/**
 * 磁盘空间回收工具。
 *
 * 背景：
 *   SQLite DELETE 只把数据页标记为"空闲（free page）"，永远不会把文件主体
 *   归还给操作系统。WAL 模式下新写入也只追加到 .db-wal，直到 checkpoint 才
 *   合并回 .db 主文件。于是"删笔记 → 查磁盘占用 → 文件大小纹丝不动"就成了
 *   用户最常投诉的"存储只涨不降"现象。
 *
 * SQLite 提供三种归还机制：
 *   1) PRAGMA auto_vacuum = INCREMENTAL （需要库**创建时**或 **VACUUM 切换后**
 *      才生效）：之后每次 COMMIT 只是把 free page 记账，但不自动还给 OS。
 *   2) PRAGMA incremental_vacuum(N)：一次性把 ≤ N 个 free page 还给 OS（实际
 *      截断文件尾）。非常廉价——不重写整库、不独占锁持续太久；适合**每次
 *      删除后都跑一次**。前提是库已处于 INCREMENTAL 模式。
 *   3) VACUUM：重写整个主库，把碎片整理掉并完全归还空间。独占锁、需要临时
 *      约等于原库大小的磁盘空间。慢而贵，只在"批量释放量大"时才值当做。
 *
 * 本模块组合 (1)+(2)，并保留对 VACUUM 的可选开关：
 *   - enableIncrementalAutoVacuum(): 数据库连接初始化时调用一次，确保新库从
 *     一开始就是 INCREMENTAL 模式；老库如果还没切过，跑一次 VACUUM 完成切换
 *     （之后才能 incremental_vacuum）。
 *   - reclaimSpace(): 每次 DELETE 后调用，做廉价回收；大批量场景可选择强制
 *     VACUUM 一次彻底整理。
 */

/** PRAGMA auto_vacuum 的数值含义（SQLite 官方定义）。 */
const AUTO_VACUUM_NONE = 0;
const AUTO_VACUUM_FULL = 1;
const AUTO_VACUUM_INCREMENTAL = 2;

/**
 * 确保当前数据库处于 INCREMENTAL auto_vacuum 模式。
 *
 * - 全新库：直接 PRAGMA auto_vacuum = 2 即生效，无成本。
 * - 已有旧库（auto_vacuum = 0 / NONE）：必须执行一次 VACUUM 才能真正切换。
 *   这次切换成本较高（重写整库），但**一个库一辈子只做一次**；之后每次删除
 *   就只跑廉价的 incremental_vacuum，用户感觉不到。
 * - 已经是 INCREMENTAL：零操作。
 *
 * 调用位置：`getDb()` 初始化连接时。失败不抛错——能跑就跑，失败只是回退到
 * 历史"占用只增不减"行为，不影响数据正确性。
 */
export function enableIncrementalAutoVacuum(db: Database.Database): void {
  try {
    const row = db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number } | undefined;
    const cur = row?.auto_vacuum ?? AUTO_VACUUM_NONE;
    if (cur === AUTO_VACUUM_INCREMENTAL) {
      return; // 已就位
    }
    // 先设置期望模式。对旧库来说这条单独不够，必须 VACUUM 才能真切。
    // 对新库（第一次初始化，还没 COMMIT 过用户数据）这一条就足够了。
    db.pragma("auto_vacuum = 2");
    // 切换：对 NONE / FULL 老库而言，下面这行 VACUUM 是真正的切换操作。
    // 对新库而言，这时候库几乎是空的，VACUUM 也几乎零成本。
    // 注意：VACUUM 不能在显式事务内执行；getDb() 初始化路径不在事务里，安全。
    if (cur !== AUTO_VACUUM_INCREMENTAL) {
      try {
        db.exec("VACUUM");
      } catch (e) {
        // 两种常见失败：
        //   1) 其它连接持有锁 —— 本进程 getDb 初始化阶段不会，自用 OK。
        //   2) 用户 DB 正好落在只读介质上 —— 只影响"占用下降"体验，数据无虞。
        console.warn(
          "[reclaimSpace] VACUUM to switch auto_vacuum failed (非致命，" +
            "旧库本次会保留 NONE/FULL 模式，直到下次能成功切换):",
          (e as Error).message,
        );
      }
    }
  } catch (e) {
    console.warn("[reclaimSpace] enableIncrementalAutoVacuum failed:", (e as Error).message);
  }
}

export interface ReclaimOptions {
  /**
   * 本次删除估算释放的字节数。仅用于判断是否值当做全量 VACUUM。
   * 没估算就传 0，则永远不会走 VACUUM 分支（只做 checkpoint + incremental）。
   */
  freedBytesEstimate?: number;
  /**
   * 超过多少字节才考虑做全量 VACUUM。默认 50MB，和历史 trash/empty 行为一致。
   * 注意：只要 auto_vacuum = INCREMENTAL 开关成功了，incremental_vacuum 已经
   * 能把文件尾截短，VACUUM 只是"额外整理碎片"，不是必须动作。
   */
  vacuumThresholdBytes?: number;
  /** 调试/审计用的标签，进日志好追踪调用方（例如 "notes.delete"）。 */
  tag?: string;
}

export interface ReclaimResult {
  /** -wal 是否成功 TRUNCATE；失败不致命。 */
  walTruncated: boolean;
  /** 是否成功执行 incremental_vacuum。 */
  incrementalVacuumed: boolean;
  /** 是否额外做了全量 VACUUM。 */
  vacuumed: boolean;
}

/**
 * 在 DELETE 之后调用，尽力回收磁盘占用。
 *
 * 执行顺序是有讲究的：
 *   1) wal_checkpoint(TRUNCATE) —— 把 -wal 合并回主文件并截到 0 字节。
 *      不做这一步，后面的 incremental_vacuum 只能动主文件，-wal 仍然又大又肥。
 *   2) incremental_vacuum —— 把主文件里 free page 归还给 OS，**真正**缩 .db。
 *      只有在 auto_vacuum = INCREMENTAL 时才生效；否则 SQLite 默默忽略。
 *   3) 可选 VACUUM —— 大释放量时顺便整理一下碎片。
 *   4) 再做一次 wal_checkpoint —— VACUUM 自己会产生新的 WAL 变更，不收尾的话
 *      用户看到的 fs.statSync(dbPath+'-wal') 又涨了，体感不爽。
 *
 * 返回执行结果供调用方写审计 / 返回给前端做 toast。
 */
export function reclaimSpace(db: Database.Database, opts: ReclaimOptions = {}): ReclaimResult {
  const {
    freedBytesEstimate = 0,
    vacuumThresholdBytes = Number(
      process.env.TRASH_VACUUM_THRESHOLD_BYTES || 50 * 1024 * 1024,
    ),
    tag = "reclaimSpace",
  } = opts;

  let walTruncated = false;
  let incrementalVacuumed = false;
  let vacuumed = false;

  // 1) wal_checkpoint(TRUNCATE)：总是做，成本极低。
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    walTruncated = true;
  } catch (e) {
    console.warn(`[${tag}] wal_checkpoint failed:`, (e as Error).message);
  }

  // 2) incremental_vacuum：总是做，只有 INCREMENTAL 模式下才真正生效。
  // 传一个"足够大"的页数，让 SQLite 把当前所有 free page 都释放。
  // 典型页大小 4KB，1_000_000 页 = 4GB 上限，对任何真实工作负载都够用。
  try {
    db.exec("PRAGMA incremental_vacuum(1000000)");
    incrementalVacuumed = true;
  } catch (e) {
    console.warn(`[${tag}] incremental_vacuum failed:`, (e as Error).message);
  }

  // 3) 条件 VACUUM：只在估算释放体量超过阈值时做（独占锁 + 重写整库的代价）。
  if (freedBytesEstimate >= vacuumThresholdBytes) {
    try {
      db.exec("VACUUM");
      vacuumed = true;
      // 4) VACUUM 产生的 WAL 再 checkpoint 一次
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.warn(`[${tag}] VACUUM failed:`, (e as Error).message);
    }
  }

  return { walTruncated, incrementalVacuumed, vacuumed };
}

// 导出常量用于单测 / 其他模块引用语义值
export const AUTO_VACUUM_MODES = {
  NONE: AUTO_VACUUM_NONE,
  FULL: AUTO_VACUUM_FULL,
  INCREMENTAL: AUTO_VACUUM_INCREMENTAL,
} as const;
