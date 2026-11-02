# 鸿蒙端使用指南

> 在鸿蒙设备上使用 nowen-note。

---

## 项目状态

nowen-note 的鸿蒙端基于 ArkWeb（WebView）实现，项目位于 `nowen-harmony/` 目录。

### 技术方案

- 使用鸿蒙原生 WebView 加载 nowen-note Web 端
- 通过 ArkWeb 与原生代码的桥接实现原生功能集成
- 复用 Web 端核心代码

---

## 构建方式

### 环境要求

- DevEco Studio（鸿蒙开发 IDE）
- HarmonyOS SDK

### 构建步骤

1. 用 DevEco Studio 打开 `nowen-harmony/` 目录
2. 配置签名和证书
3. 连接鸿蒙设备或模拟器
4. 点击运行

---

## 功能支持

鸿蒙端通过 WebView 加载 Web 端，因此支持 Web 端的所有功能：

- ✅ 富文本和 Markdown 编辑
- ✅ 文档树和笔记管理
- ✅ AI 功能
- ✅ 思维导图
- ✅ 标签、收藏、搜索
- ✅ 分享和协作

---

## 注意事项

- 鸿蒙端目前处于开发阶段
- 部分原生功能可能有限制
- 建议使用最新的 HarmonyOS 版本

---

## 下一步

- [Web 端使用指南](./web.md)
- [Android 使用指南](./android.md)
- [桌面端使用指南](./desktop.md)

---

> 本教程基于 nowen-note v1.1.18 编写。
