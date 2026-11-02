import { Hono } from "hono";
import { getDb } from "../db/schema";
import crypto from "crypto";
import {
  getUserWorkspaceRole,
  canManageResource,
} from "../middleware/acl";
import { taskProjectsRepository } from "../repositories";

const taskProjects = new Hono();

/** Resolve scope: personal vs workspace */
function resolveScope(c: any, userId: string) {
  const raw = c.req.query("workspaceId");
  if (!raw || raw === "personal") return { workspaceId: null };
  const role = getUserWorkspaceRole(raw, userId);
  if (!role) return { workspaceId: raw, error: "No access to workspace" };
  return { workspaceId: raw };
}

// List projects
taskProjects.get("/", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const scope = resolveScope(c, userId);
  if (scope.error) return c.json({ error: scope.error }, 403);

  const rows = taskProjectsRepository.listByUser(userId, scope.workspaceId);
  return c.json(rows);
});

// Role level helper for workspace permission checks
const ROLE_RANK: Record<string, number> = { viewer: 1, commenter: 2, editor: 3, admin: 4, owner: 5 };

// Create project
taskProjects.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();
  const scope = resolveScope(c, userId);
  if (scope.error) return c.json({ error: scope.error }, 403);

  // Fix 4: viewer/commenter cannot create projects in workspace
  if (scope.workspaceId) {
    const role = getUserWorkspaceRole(scope.workspaceId, userId) as string | null;
    if (!role || (ROLE_RANK[role] ?? 0) < ROLE_RANK["editor"]) {
      return c.json({ error: "Insufficient permissions to create project", code: "FORBIDDEN" }, 403);
    }
  }

  const id = crypto.randomUUID();
  const name = body.name || "Untitled";
  const icon = body.icon || "folder";
  const color = body.color || "#6366f1";
  const sortOrder = body.sortOrder ?? 0;

  taskProjectsRepository.create({ id, userId, workspaceId: scope.workspaceId, name, icon, color, sortOrder });
  const project = taskProjectsRepository.getByIdWithStats(id);
  return c.json(project, 201);
});

// Update project
taskProjects.put("/:id", async (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const existing = taskProjectsRepository.getById(id);
  if (!existing) return c.json({ error: "Project not found" }, 404);
  if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
    return c.json({ error: "Forbidden", code: "FORBIDDEN" }, 403);
  }

  const body = await c.req.json();
  const name = body.name ?? existing.name;
  const icon = body.icon ?? existing.icon;
  const color = body.color ?? existing.color;
  const sortOrder = body.sortOrder ?? existing.sortOrder;

  taskProjectsRepository.update(id, { name, icon, color, sortOrder });
  const updated = taskProjectsRepository.getByIdWithStats(id);
  return c.json(updated);
});

// Delete project (tasks are NOT deleted, just unlinked)
taskProjects.delete("/:id", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const existing = taskProjectsRepository.getById(id);
  if (!existing) return c.json({ error: "Project not found" }, 404);
  if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
    return c.json({ error: "Forbidden", code: "FORBIDDEN" }, 403);
  }

  taskProjectsRepository.delete(id);
  return c.json({ success: true });
});

// Reorder projects
taskProjects.put("/reorder/batch", async (c) => {
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();
  const items = body.items as { id: string; sortOrder: number }[];

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "items required" }, 400);
  }

  const safeItems = items.slice(0, 100);

  // Fix 3: validate permissions for every project
  for (const item of safeItems) {
    const project = taskProjectsRepository.getById(item.id);
    if (!project) return c.json({ error: `Project ${item.id} not found`, code: "NOT_FOUND" }, 404);
    if (!canManageResource(project.userId, project.workspaceId, userId)) {
      return c.json({ error: "No permission to reorder project " + item.id, code: "FORBIDDEN" }, 403);
    }
  }

  taskProjectsRepository.updateSortOrder(safeItems);
  return c.json({ success: true });
});

export default taskProjects;
