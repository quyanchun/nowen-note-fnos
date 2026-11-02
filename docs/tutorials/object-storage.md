# 对象存储（S3/R2）配置

> 将附件存储到 S3、Cloudflare R2 或 MinIO 等对象存储服务。

---

## 为什么用对象存储？

- 服务器磁盘空间有限
- 对象存储更便宜、更可靠
- CDN 加速图片加载
- 适合大规模部署

---

## 支持的服务

| 服务 | 说明 |
|---|---|
| AWS S3 | 亚马逊云存储 |
| Cloudflare R2 | Cloudflare 对象存储（免出口费） |
| MinIO | 自建 S3 兼容存储 |
| 其他 S3 兼容 | 任何兼容 S3 协议的服务 |

---

## 配置步骤

### 步骤一：创建存储桶

在你的对象存储服务中创建一个 Bucket。

### 步骤二：配置 nowen-note

1. ⚙️ 设置 → 数据管理 → 对象存储
2. 填写配置：
   - **Endpoint**：服务地址
   - **Bucket**：存储桶名称
   - **Access Key**：访问密钥
   - **Secret Key**：密钥
   - **Region**：区域（如适用）
3. 点击「测试连接」
4. 保存配置

[截图：对象存储配置]

### 步骤三：迁移现有附件

配置完成后，可以选择将现有本地附件迁移到对象存储。

---

## Cloudflare R2 配置示例

1. 登录 Cloudflare Dashboard
2. 创建 R2 Bucket
3. 创建 API Token（权限：Object Read & Write）
4. 在 nowen-note 中填写：
   - Endpoint：`https://<account-id>.r2.cloudflarestorage.com`
   - Bucket：你的 Bucket 名称
   - Access Key：Token 的 Access Key ID
   - Secret Key：Token 的 Secret Access Key

---

## MinIO 配置示例

1. 部署 MinIO 服务
2. 创建 Bucket
3. 创建访问密钥
4. 在 nowen-note 中填写 MinIO 的 Endpoint 和密钥

---

## 常见问题

### Q：配置后图片还是存在本地？

确认测试连接成功后保存。已有的附件需要手动迁移。

### Q：对象存储费用？

R2 免出口费，存储费用很低。S3 按使用量计费。

---

## 下一步

- [附件上传和管理](./attachments.md) — 附件基础
- [数据备份与迁移](./backup-migrate.md) — 备份策略

---

> 本教程基于 nowen-note v1.1.18 编写。
