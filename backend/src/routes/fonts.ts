import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { customFontsRepository, systemSettingsRepository } from "../repositories";

const fonts = new Hono();

const FONTS_DIR = path.join(process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"), "fonts");

// 确保字体目录存在
function ensureFontsDir() {
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }
}

// 从字体文件名中提取可读名称
function extractFontName(filename: string): string {
  return filename
    .replace(/\.(otf|otc|ttc|ttf|woff|woff2)$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

// 获取字体列表
fonts.get("/", (c) => {
  const rows = customFontsRepository.getList();
  return c.json(rows);
});

// 上传字体（支持多文件批量上传）
fonts.post("/upload", async (c) => {
  ensureFontsDir();

  const body = await c.req.parseBody({ all: true });
  const files = body["files"];

  if (!files) {
    return c.json({ error: "未选择字体文件" }, 400);
  }

  // 统一为数组处理
  const fileList = Array.isArray(files) ? files : [files];
  const ALLOWED_EXT = [".otf", ".otc", ".ttc", ".ttf", ".woff", ".woff2"];
  // 常用中文开源字体（如霞鹜文楷）体积通常超过 20MB，放宽到 50MB。
  const MAX_SIZE_MB = 50;
  const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

  const results: any[] = [];
  const errors: string[] = [];

  for (const file of fileList) {
    if (!(file instanceof File)) {
      errors.push("无效的文件对象");
      continue;
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      errors.push(`${file.name}: 不支持的格式 (仅支持 ${ALLOWED_EXT.join(", ")})`);
      continue;
    }

    if (file.size > MAX_SIZE) {
      errors.push(`${file.name}: 文件过大 (最大 ${MAX_SIZE_MB}MB)`);
      continue;
    }

    // 检查文件名是否已存在
    if (customFontsRepository.existsByFileName(file.name)) {
      errors.push(`${file.name}: 字体已存在`);
      continue;
    }

    try {
      const id = uuid();
      const buffer = Buffer.from(await file.arrayBuffer());
      const savePath = path.join(FONTS_DIR, `${id}${ext}`);

      fs.writeFileSync(savePath, buffer);

      const name = extractFontName(file.name);
      const format = ext.slice(1); // remove dot

      customFontsRepository.create({ id, name, fileName: file.name, format, fileSize: file.size });

      results.push({ id, name, fileName: file.name, format });
    } catch (err: any) {
      errors.push(`${file.name}: 上传失败 (${err.message})`);
    }
  }

  return c.json({ uploaded: results, errors });
});

// 获取字体文件（用于 @font-face src）
fonts.get("/file/:id", (c) => {
  const id = c.req.param("id");
  const row = customFontsRepository.getByIdForDownload(id);

  if (!row) {
    return c.json({ error: "字体不存在" }, 404);
  }

  const filePath = path.join(FONTS_DIR, `${row.id}.${row.format}`);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: "字体文件丢失" }, 404);
  }

  const mimeMap: Record<string, string> = {
    otf: "font/otf",
    ttf: "font/ttf",
    otc: "font/collection",
    ttc: "font/collection",
    woff: "font/woff",
    woff2: "font/woff2",
  };

  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    headers: {
      "Content-Type": mimeMap[row.format] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// 删除字体
fonts.delete("/:id", (c) => {
  const id = c.req.param("id");
  const row = customFontsRepository.getById(id);

  if (!row) {
    return c.json({ error: "字体不存在" }, 404);
  }

  // 删除文件
  const filePath = path.join(FONTS_DIR, `${row.id}.${row.format}`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // 删除数据库记录
  customFontsRepository.delete(id);

  // 如果当前设置使用了该字体，重置为默认
  systemSettingsRepository.delete("editor_font_family");

  return c.json({ success: true });
});

export default fonts;