# 桌面端（Electron）使用指南

> 在 Windows、macOS、Linux 上使用 nowen-note 桌面客户端。

---

## 下载安装

从 [Releases 页面](https://github.com/cropflre/nowen-note/releases) 下载对应系统的安装包：

| 系统 | 格式 |
|---|---|
| Windows | .exe 安装包 |
| macOS | .dmg 安装包 |
| Linux | .AppImage / .deb |

---

## 首次启动

### Windows

双击安装包安装，然后从开始菜单或桌面快捷方式启动。

### macOS

1. 打开 .dmg 文件
2. 将应用拖到 Applications 文件夹
3. ⚠️ 首次打开可能报错，需要执行：

```bash
sudo xattr -dr com.apple.quarantine "/Applications/Nowen Note.app"
```

4. 重新双击打开

### Linux

```bash
chmod +x Nowen-Note-*.AppImage
./Nowen-Note-*.AppImage
```

---

## 桌面端特有功能

### macOS 全局快速搜索

登录后按 **Ctrl + 空格** 打开面板。在「设置 → 快捷键 → 全局快速搜索快捷键」可以更换组合键或停用；如果组合键已被占用，设置页会提示。

- 输入关键词，结果中会显示笔记标题、摘要和笔记本。直接按回车可展开更多结果。点击一条结果，或用上下方向键选中后按回车，即可在右侧阅读正文。详情中的「在 App 中打开」可进入主窗口编辑。
- 切到「问答」后按回车提问。面板先检索笔记，再用 Markdown 展示回答。下方的「引用来源」列出每条来源的摘要和可用的笔记本、更新时间，点击即可在右侧阅读。面板打开期间，切换模式会保留两边的输入和阅读进度。
- 点击右上角的新建按钮即可记笔记。点击「保存笔记」或按 ⌘Enter 保存到「收集箱」。暂时收起面板后，再次点击新建可以继续写草稿。
- 按 Esc 先收起右侧详情或草稿，再按一次关闭面板。主窗口点红色关闭按钮后仍可用快捷键唤起，按 ⌘Q 完全退出。

### 本地模式

桌面端支持「本地模式」—— 后端直接运行在你的电脑上，不需要服务器。

1. 启动后选择「本地模式」
2. 后端自动启动（端口 3001）
3. 数据存储在本地

### 云端模式

也可以连接到远程服务器：

1. 启动后选择「云端模式」
2. 输入服务器地址
3. 登录账号

### 模式切换

可以在本地模式和云端模式之间切换。切换时数据不会丢失。

---

## 自动更新

桌面端支持自动更新。有新版本时会弹出提示，点击即可更新。

---

## 常见问题

### Q：macOS 报错 "ERR_DLOPEN_FAILED"？

执行 ```bash
sudo xattr -dr com.apple.quarantine "/Applications/Nowen Note.app"
```

### Q：后端启动超时？

检查端口 3001 是否被其他程序占用。

### Q：数据在哪里？

- 本地模式：`~/nowen-note/data/`（macOS/Linux）或 `%APPDATA%/nowen-note/data/`（Windows）
- 云端模式：数据在服务器上

---

## 下一步

- [Web 端使用指南](./web.md) — 浏览器使用
- [Android 使用指南](./android.md) — 移动端
- [数据备份与迁移](./backup-migrate.md) — 备份数据

---

> 本教程基于 nowen-note v1.1.18 编写。
