# Android 移动端使用指南

> 在 Android 手机或平板上使用 nowen-note。

---

## 安装

### 方式一：APK 安装（推荐）

1. 从 [Releases](https://github.com/cropflre/nowen-note/releases) 下载最新 APK
2. 在手机上打开安装（需允许安装未知来源应用）

### 方式二：浏览器访问

在手机浏览器中直接访问你的服务器地址。

---

## 连接服务器

1. 打开 nowen-note App
2. 输入服务器地址
3. 登录账号

---

## 移动端操作指南

### 侧边栏

- 点击左上角 ☰ 打开侧边栏
- 侧边栏中可以切换笔记本、查看标签、切换功能模块

### 笔记编辑

- 点击笔记进入编辑器
- 编辑器支持所有富文本格式
- 格式工具栏在键盘上方
- 自动保存

### 手势操作

| 手势 | 效果 |
|---|---|
| 点击 | 选择/打开 |
| 长按 | 弹出操作菜单 |
| 左滑 | 打开侧边栏 |

---

## 图片保存到相册

在 Android 原生环境中，笔记中的图片可以直接保存到系统相册，无需额外授权（Android 10+ 使用 MediaStore API，无需 `WRITE_EXTERNAL_STORAGE` 权限）。

### 导出整篇笔记图片

将整篇笔记渲染为图片后自动保存到相册：

1. 在笔记列表中**长按**笔记，弹出操作菜单
2. 选择 **导出 > 图片 PNG** 或 **图片 JPG**
3. 图片渲染完成后自动保存到系统相册的 **Pictures/Nowen Note** 目录
4. 保存成功后屏幕底部会提示「已保存到相册」

PNG 格式无损、适合存档；JPG 格式体积更小、适合分享。超长笔记（高度超过 20000px）会弹出确认提示，避免生成过大的图片。

### 编辑器内单张图片保存

在编辑器中选中任意一张图片，可以单独将其保存到相册：

1. 在编辑器中**点击**图片使其选中（图片周围出现蓝色选中框）
2. 选中后图片左上角出现 **下载按钮**（向下箭头图标）
3. 点击下载按钮，图片自动保存到相册
4. 保存成功后提示「已保存到相册」

该功能通过 Capacitor 原生插件 `MediaStoreSave` 实现，图片以原始分辨率保存。

---

## 图片预览与缩放

在编辑器中**双击**任意图片可打开全屏预览（Lightbox）。

### 桌面端布局

预览时顶部工具栏包含：放大、缩小、重置、缩放百分比、关闭按钮。支持鼠标滚轮缩放和拖拽平移。

### 移动端适配

移动端图片预览针对触屏做了专门优化，工具栏布局与桌面端不同：

| 区域 | 内容 | 说明 |
|---|---|---|
| **顶部** | 关闭按钮 | 固定在右上角，自动避让系统状态栏（safe-area-inset-top） |
| **底部** | 缩放工具栏 | 缩小 / 重置 / 百分比 / 放大，自动避让导航栏（safe-area-inset-bottom） |

- 关闭按钮：固定在屏幕右上角，`top = safe-area-inset-top + 12px`，确保刘海屏/挖孔屏下不被遮挡
- 缩放工具栏：居中悬浮在屏幕底部，`bottom = safe-area-inset-bottom + 16px`，胶囊形半透明背景，不遮挡图片内容
- 所有按钮尺寸为 44px（符合移动端触控最小热区标准），间距充足，单手可操作

支持双指捏合缩放和单指拖拽平移。

---

## Capacitor 技术

nowen-note 的 Android 端基于 Capacitor 构建：

- 核心代码和 Web 端共享
- 通过 Capacitor 桥接原生功能
- 支持 Android 系统级功能（相册保存、状态栏控制、键盘适配等）

### 构建命令

如需自行构建 Android 端，执行以下命令：

```bash
# 1. 安装依赖并构建前端
cd frontend
npm install
npm run build

# 2. 同步到 Android 项目
npx cap sync android

# 3. 在 Android Studio 中打开
npx cap open android
```

`npx cap sync android` 会完成两件事：
- 将 `frontend/dist` 目录的 Web 资源复制到 Android 项目的 `app/src/main/assets/public` 目录
- 同步 Capacitor 插件的原生代码到 Android 项目

### Live Reload（开发调试）

开发时可启用 Live Reload，在真机上实时预览代码修改：

```bash
# 设置电脑的局域网 IP，启动 dev server 后执行
CAP_LIVE_URL=http://192.168.x.x:5173 npx cap sync android
npx cap run android
```

> **注意**：发布正式版 APK 前务必清除 `CAP_LIVE_URL` 环境变量，否则生成的 APK 会尝试连接局域网地址，在其他设备上会白屏。

---

## 常见问题

### Q：打不开侧边栏？

确认是点击 ☰ 按钮。

### Q：编辑时内容被键盘遮挡？

编辑器会自动滚动让光标可见。Capacitor 配置了 `adjustNothing` 模式，键盘以浮层方式覆盖在 WebView 上方，前端通过键盘高度监听自动调整编辑区域的内边距。

### Q：和桌面端数据同步吗？

是的。登录同一账号，数据通过服务器实时同步。

### Q：保存图片后在相册里找不到？

图片保存在系统相册的 **Pictures/Nowen Note** 目录下。不同手机品牌的相册应用显示方式不同：

| 手机品牌 | 查找路径 |
|---|---|
| 小米 / Redmi | 相册 > 相册标签 > 其他相册 > Nowen Note |
| 华为 / 荣耀 | 图库 > 相册 > 其他 > Nowen Note |
| OPPO / realme | 相册 > 图集 > Nowen Note |
| vivo / iQOO | 相册 > 相册页 > Nowen Note |
| 三星 | 相册 > 相册 > Pictures > Nowen Note |
| Google Pixel | 照片 > 库 > Pictures > Nowen Note |

如果在相册中刷新后仍看不到，请检查：
- 存储空间是否充足
- 手机是否有「媒体访问权限」限制（部分国产 ROM 需要手动授权）

### Q：Web 下载和 Android 相册保存有什么区别？

| 对比项 | Web 浏览器下载 | Android 相册保存 |
|---|---|---|
| 保存位置 | 浏览器下载文件夹 | 系统相册 Pictures/Nowen Note |
| 是否可在相册查看 | 否（在文件管理器中） | 是 |
| 保存方式 | 浏览器 `saveAs` 触发下载 | Capacitor MediaStore API 直接写入 |
| 所需权限 | 无特殊要求 | Android 10+ 无需额外权限 |
| 适用环境 | 浏览器访问 / WebView | Capacitor 原生 App |

在 Android 原生 App 中，图片导出会优先走相册保存路径；如果原生保存失败（插件异常或权限不足），会自动降级为浏览器下载，保证用户始终能拿到文件。

### Q：APK 更新后图片保存失败或白屏？

APK 覆盖安装后可能出现以下情况：

**图片保存失败**
- 原因：旧版本的 Capacitor 插件缓存与新版本不兼容
- 解决：进入手机 **设置 > 应用 > Nowen Note > 存储**，点击「清除缓存」（不要点「清除数据」，否则会丢失登录状态）

**启动白屏**
- 原因：WebView 的 localStorage 中存储了旧版本的登录 token 或服务器地址，新版本的 Capacitor androidScheme 变更导致 origin 不同，旧数据无法读取
- 解决：
  1. 清除应用缓存后重新打开
  2. 如果仍白屏，清除应用数据后重新登录
  3. 确保连接的服务器地址正确

**权限问题**
- Android 系统会保留已授予的权限，一般不会因更新丢失
- 如果出现权限异常，进入 **设置 > 应用 > Nowen Note > 权限** 手动重新授权

---

## 下一步

- [Web 端使用指南](./web.md)
- [桌面端使用指南](./desktop.md)
- [鸿蒙端使用指南](./harmony.md)

---

> 本教程基于 nowen-note v1.1.18 编写。
