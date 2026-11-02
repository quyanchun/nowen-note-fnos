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
