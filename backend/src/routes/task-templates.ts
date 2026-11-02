import { Hono } from 'hono';
import { getDb } from '../db/schema';
import crypto from 'crypto';
import { getUserWorkspaceRole, canManageResource } from '../middleware/acl';
import { taskTemplatesRepository } from '../repositories';

const taskTemplates = new Hono();

function normalizeTemplateItems(items: any[]): any[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map((item, i) => ({
    title: typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '',
    description: typeof item.description === 'string' ? item.description : '',
    priority: [1, 2, 3].includes(item.priority) ? item.priority : 2,
    relativeDueDays: typeof item.relativeDueDays === 'number' ? item.relativeDueDays : null,
    parentIndex: typeof item.parentIndex === 'number' && item.parentIndex >= 0 ? item.parentIndex : null,
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : i,
  })).filter(item => item.title.length > 0);
}

function resolveScope(c: any, userId: string) {
  const raw = c.req.query('workspaceId');
  if (!raw || raw === 'personal') return { workspaceId: null };
  const role = getUserWorkspaceRole(raw, userId);
  if (!role) return { workspaceId: raw, error: 'No access to workspace' };
  return { workspaceId: raw };
}

taskTemplates.get('/', (c) => {
  const userId = c.req.header('X-User-Id')!;
  const scope = resolveScope(c, userId);
  if (scope.error) return c.json({ error: scope.error }, 403);

  const rows = taskTemplatesRepository.listByUser(userId, scope.workspaceId);
  return c.json(rows.map((r: any) => ({ ...r, items: JSON.parse(r.items || '[]') })));
});

taskTemplates.post('/', async (c) => {
  const userId = c.req.header('X-User-Id')!;
  const scope = resolveScope(c, userId);
  if (scope.error) return c.json({ error: scope.error }, 403);

  const body = await c.req.json();
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Name is required', code: 'INVALID_NAME' }, 400);
  }
  const items = normalizeTemplateItems(body.items);

  const id = crypto.randomUUID();
  taskTemplatesRepository.create({
    id,
    userId,
    workspaceId: scope.workspaceId,
    name: body.name.trim(),
    description: body.description || null,
    icon: body.icon || null,
    color: body.color || null,
    items,
  });

  const row = taskTemplatesRepository.getById(id);
  return c.json({ ...row, items: JSON.parse(row?.items || '[]') }, 201);
});

taskTemplates.put('/:id', async (c) => {
  const userId = c.req.header('X-User-Id')!;
  const id = c.req.param('id');
  const row = taskTemplatesRepository.getById(id);
  if (!row) return c.json({ error: 'Not found' }, 404);

  if (row.workspaceId) {
    const role = getUserWorkspaceRole(row.workspaceId, userId);
    if (!role) return c.json({ error: 'No access' }, 403);
    if (row.userId !== userId && role !== 'admin' && role !== 'owner') {
      return c.json({ error: 'Not allowed' }, 403);
    }
  } else if (row.userId !== userId) {
    return c.json({ error: 'Not allowed' }, 403);
  }

  const body = await c.req.json();
  const updates: any = {};

  if (body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'Name is required', code: 'INVALID_NAME' }, 400);
    }
    updates.name = body.name.trim();
  }
  if (body.description !== undefined) updates.description = body.description || null;
  if (body.icon !== undefined) updates.icon = body.icon || null;
  if (body.color !== undefined) updates.color = body.color || null;
  if (body.items !== undefined) updates.items = normalizeTemplateItems(body.items);

  if (Object.keys(updates).length === 0) return c.json({ ...row, items: JSON.parse(row.items || '[]') });

  taskTemplatesRepository.update(id, updates);
  const updated = taskTemplatesRepository.getById(id);
  return c.json({ ...updated, items: JSON.parse(updated?.items || '[]') });
});

taskTemplates.delete('/:id', (c) => {
  const userId = c.req.header('X-User-Id')!;
  const id = c.req.param('id');
  const row = taskTemplatesRepository.getById(id);
  if (!row) return c.json({ error: 'Not found' }, 404);

  if (row.workspaceId) {
    const role = getUserWorkspaceRole(row.workspaceId, userId);
    if (!role) return c.json({ error: 'No access' }, 403);
    if (row.userId !== userId && role !== 'admin' && role !== 'owner') {
      return c.json({ error: 'Not allowed' }, 403);
    }
  } else if (row.userId !== userId) {
    return c.json({ error: 'Not allowed' }, 403);
  }

  taskTemplatesRepository.delete(id);
  return c.json({ success: true });
});

taskTemplates.post('/:id/apply', async (c) => {
  const db = getDb();
  const userId = c.req.header('X-User-Id')!;
  const id = c.req.param('id');
  const row = taskTemplatesRepository.getById(id);
  if (!row) return c.json({ error: 'Not found' }, 404);

  if (row.workspaceId) {
    const role = getUserWorkspaceRole(row.workspaceId, userId);
    if (!role) return c.json({ error: 'No access' }, 403);
  } else if (row.userId !== userId) {
    return c.json({ error: 'Not allowed' }, 403);
  }

  const body = await c.req.json();
  const projectId = body.projectId || null;
  const parentId = body.parentId || null;
  const baseDateStr = body.baseDate || null;

  if (projectId) {
    const proj = db.prepare('SELECT * FROM task_projects WHERE id = ?').get(projectId) as any;
    if (!proj) return c.json({ error: 'Project not found' }, 404);
    if (row.workspaceId) {
      if (proj.workspaceId !== row.workspaceId) return c.json({ error: 'Project belongs to different scope' }, 403);
    } else {
      if (proj.userId !== userId || proj.workspaceId) return c.json({ error: 'Project belongs to different scope' }, 403);
    }
  }

  if (parentId) {
    const parentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parentId) as any;
    if (!parentTask) return c.json({ error: 'Parent task not found' }, 404);
    if (row.workspaceId) {
      if (parentTask.workspaceId !== row.workspaceId) return c.json({ error: 'Parent task belongs to different scope' }, 403);
    } else {
      if (parentTask.userId !== userId || parentTask.workspaceId) return c.json({ error: 'Parent task belongs to different scope' }, 403);
    }
  }

  const items = JSON.parse(row.items || '[]') as Array<{
    title: string; description?: string; priority: number; relativeDueDays: number; parentIndex: number | null; sortOrder: number;
  }>;

  if (items.length === 0) return c.json({ createdTasks: [] });

  const baseDate = baseDateStr ? new Date(baseDateStr + 'T00:00:00') : null;
  const createdIds: string[] = [];
  const createdTasks: any[] = [];

  const insertStmt = db.prepare(
    'INSERT INTO tasks (id, userId, workspaceId, title, description, priority, isCompleted, completedAt, status, sortOrder, projectId, parentId, dueDate, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, \'todo\', ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))'
  );

  const createAll = db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.title || typeof item.title !== 'string') continue;

      const taskId = crypto.randomUUID();
      let dueDate: string | null = null;
      if (baseDate && typeof item.relativeDueDays === 'number') {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + item.relativeDueDays);
        dueDate = d.toISOString().split('T')[0];
      }

      const resolvedParentId =
        item.parentIndex !== null && item.parentIndex >= 0 && item.parentIndex < createdIds.length
          ? createdIds[item.parentIndex]
          : parentId;

      const description = typeof item.description === 'string' ? item.description : '';
      insertStmt.run(taskId, userId, row.workspaceId || null, item.title.trim(), description, item.priority || 2, item.sortOrder || i, projectId, resolvedParentId, dueDate);

      createdIds.push(taskId);
      createdTasks.push({ id: taskId, title: item.title.trim(), description, priority: item.priority || 2, dueDate, projectId, parentId: resolvedParentId, status: 'todo', isCompleted: 0 });
    }
  });

  createAll();

  return c.json({ createdTasks, count: createdTasks.length });
});

export default taskTemplates;
