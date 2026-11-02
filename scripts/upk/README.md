# 绿联 NAS（UGOS Pro）upk 打包

把当前项目打包成绿联开发者平台要求的 `.upk` Docker 应用包。

## 前置条件

1. 项目根目录有 `ugcli.exe`（绿联开发者工具，从 https://developer.ugnas.com 下载）。
2. 本机已构建好 `nowen-note:<version>` 镜像（可同时含 amd64 / arm64）。
   - 单机一次性构建两架构推荐用 `docker buildx`：
     ```
     docker buildx build --platform linux/amd64,linux/arm64 \
       -t nowen-note:1.1.5 --load .
     ```
     注意 `buildx --load` 一次只能加载一个架构，多架构请分两次：
     ```
     docker buildx build --platform linux/amd64 -t nowen-note:1.1.5      --load .
     docker buildx build --platform linux/arm64 -t nowen-note:1.1.5-arm64 --load .
     ```
3. Node.js 已装 `sharp`（项目根 `package.json` 已声明）。

## 一键打包

```
npm run build:upk
```

或带参数：

```
node scripts/upk/build-upk.mjs --build 1 --arch all
node scripts/upk/build-upk.mjs --arch amd64
node scripts/upk/build-upk.mjs --version 1.1.5 --build 2
```

参数：

- `--version <x.y.z>` 应用版本号（默认 `package.json.version`）
- `--build <n>`       构建号（默认 `1`，会拼成最终版本号 `x.y.z.n`）
- `--arch all|amd64|arm64` 要打的架构（默认 `all`）
- `--image <repo:tag>` 自定义镜像名（默认 `nowen-note:<version>`）
- `--keep-images`     保留中间 tar，便于调试（默认打完清理）

脚本会：

1. 在 `dist-upk/nowen-note-<version>/` 下生成绿联标准目录（`project.yaml` + `rootfs_amd64/images/*.tar` + `rootfs_arm64/images/*.tar` + `rootfs_common/{icon.png,docker-compose.yaml}`）。
2. 调用 `ugcli check` 校验，通过后调 `ugcli pack` 生成 `.upk`。
3. 把 `.upk` 搬到 `dist-upk/`，并清理大块 tar（避免 git add）。

## 安装到绿联 NAS

1. 把 `.upk` 文件上传到管理员账号的「我的文件」。
2. 进入「应用中心 → 右上角 ⚙ 设置 → 本地安装」，选择该 `.upk` 文件。
3. 安装时填写「数据目录」（建议 `/volume1/AppData/nowen-note`）。
