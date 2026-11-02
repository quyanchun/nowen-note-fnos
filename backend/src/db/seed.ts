import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";

function syncIcpBeianFromEnv() {
  const db = getDb();
  const raw = process.env.NOWEN_ICP_BEIAN ?? process.env.ICP_BEIAN ?? "";
  const value = String(raw).trim().slice(0, 80);
  db.prepare(`
    INSERT INTO system_settings (key, value, updatedAt)
    VALUES ('site_icp_beian', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
  `).run(value);
}

export function seedDatabase() {
  const db = getDb();

  // ICP 备案号由 Docker/运行时环境变量驱动，不再通过设置页写入。
  // 每次启动都同步一次，避免旧数据库里残留的 site_icp_beian 继续影响登录页展示。
  syncIcpBeianFromEnv();

  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count > 0) return;

  const userId = uuid();
  const passwordHash = bcrypt.hashSync(process.env.NOWEN_INITIAL_ADMIN_PASSWORD || "admin123", 10);

  db.prepare(`
    INSERT INTO users (id, username, email, passwordHash, role, displayName) VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, "admin", "admin@nowen-note.local", passwordHash, "admin", "管理员");

  const nb1Id = uuid();
  const nb2Id = uuid();
  const nb3Id = uuid();

  db.prepare(`INSERT INTO notebooks (id, userId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(nb1Id, userId, "工作笔记", "💼", 0);
  db.prepare(`INSERT INTO notebooks (id, userId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(nb2Id, userId, "个人日记", "📔", 1);
  db.prepare(`INSERT INTO notebooks (id, userId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?)`).run(nb3Id, userId, "技术学习", "🧑‍💻", 2);

  const subNbId = uuid();
  db.prepare(`INSERT INTO notebooks (id, userId, parentId, name, icon, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`).run(subNbId, userId, nb3Id, "前端笔记", "⚛️", 0);

  const notes = [
    { notebookId: nb1Id, title: "项目启动会议纪要", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"今天讨论了 nowen-note 项目的整体架构方案..."}]}]}', contentText: "今天讨论了 nowen-note 项目的整体架构方案..." },
    { notebookId: nb1Id, title: "Q1 目标与 OKR", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"2026 年 Q1 核心目标：完成 nowen-note v1.0 发布"}]}]}', contentText: "2026 年 Q1 核心目标：完成 nowen-note v1.0 发布", isPinned: 1 },
    { notebookId: nb2Id, title: "周末计划", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"周六去图书馆，周日整理房间"}]}]}', contentText: "周六去图书馆，周日整理房间" },
    { notebookId: nb3Id, title: "React Server Components 学习", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"RSC 是 React 18 引入的新范式，可以在服务端渲染组件..."}]}]}', contentText: "RSC 是 React 18 引入的新范式，可以在服务端渲染组件..." },
    { notebookId: subNbId, title: "Tiptap 编辑器集成指南", content: '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Tiptap 快速开始"}]},{"type":"paragraph","content":[{"type":"text","text":"Tiptap 是基于 ProseMirror 的现代富文本编辑器框架..."}]},{"type":"codeBlock","attrs":{"language":"typescript"},"content":[{"type":"text","text":"import { useEditor } from \\\"@tiptap/react\\\""}]}]}', contentText: "Tiptap 快速开始 Tiptap 是基于 ProseMirror 的现代富文本编辑器框架... import { useEditor } from \"@tiptap/react\"", isFavorite: 1 },
  ];

  for (const note of notes) {
    const noteId = uuid();
    db.prepare(`
      INSERT INTO notes (id, userId, notebookId, title, content, contentText, isPinned, isFavorite)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(noteId, userId, note.notebookId, note.title, note.content, note.contentText, note.isPinned || 0);
    // Y1: 收藏语义已迁移到 favorites 表（per-user）。seed 里的 isFavorite:1 翻译为
    // "种子用户自己收藏了这条笔记"。物理列 notes.isFavorite 始终写 0（过渡期保留）。
    if (note.isFavorite) {
      db.prepare(`
        INSERT OR IGNORE INTO favorites (userId, noteId, workspaceId, createdAt)
        VALUES (?, ?, NULL, datetime('now'))
      `).run(userId, noteId);
    }
  }

  const tag1Id = uuid();
  const tag2Id = uuid();
  const tag3Id = uuid();
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag1Id, userId, "重要", "#f85149");
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag2Id, userId, "技术", "#58a6ff");
  db.prepare(`INSERT INTO tags (id, userId, name, color) VALUES (?, ?, ?, ?)`).run(tag3Id, userId, "灵感", "#7ee787");

  console.log("✅ Database seeded successfully");
}
