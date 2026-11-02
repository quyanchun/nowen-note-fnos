# 开发阶段快速部署

从当前工作区最新源码构建，不生成旧包备份、不做回滚；不清空笔记、配置或同步队列，不改 NAS 入口、端口和系统 Nginx。

```bash
./scripts/dev-deploy.sh all    # 一次构建，更新 NAS + Mac
./scripts/dev-deploy.sh nas    # 只更新 NAS
./scripts/dev-deploy.sh mac    # 只更新 Mac
./scripts/dev-deploy.sh build  # 只构建并生成 NAS 资源包
```

`all` / `mac` 前先退出笔记客户端；更新后脚本自动打开。应用启动后的页面验收仍需实际查看。

首次配置 `deploy/fnos-private/dev.local.env`（已被 Git 忽略）：

```bash
NAS_SSH=user@nas-host
NAS_CONTROL_PATH=/tmp/nowen-nas-ssh.sock
NAS_KEYCHAIN_SERVICE="本机钥匙串中的 NAS SSH 条目名"
NAS_KEYCHAIN_ACCOUNT=user
NAS_UPLOAD_DIR=/home/user/nowen-dev
MAC_APP="/Applications/Nowen Note.app"
# 可选：沿用本机已有签名身份，填写 security find-identity 返回的 SHA-1
# MAC_SIGN_IDENTITY="已有签名身份的 SHA-1"
```

macOS 可以复用已保存的钥匙串凭据；密码不会写进源码、配置或日志。不配置钥匙串时，使用已有 SSH 登录方式及 sudo 提示。SSH 主机指纹须已确认，脚本不跳过主机校验。需要已安装项目依赖、Node.js、Python3、NAS Docker Compose，以及 Mac 原有安装包。

脚本执行：

1. 直接构建当前 `backend`、`frontend`，不取旧发布快照或旧 dist。
2. 仅上传这次编译资源包，在 NAS 现有运行镜像上构建新应用层，不传整个几百 MB 镜像。
3. 从运行容器自动读取 Compose 路径、UID/GID和数据挂载，只更换本应用 image，再 `compose up`。镜像达到 100 层时先整理运行文件系统，保留环境、用户与健康检查；用户数据挂载不参与镜像整理。
4. 用飞牛官方 `appcenter-cli status/start` 保持应用入口启用，检查容器健康和实际资源哈希。
5. Mac 原位替换构建资源，递增构建号并重新签名、启动。结果保存在 `dist-private/dev-deploy/mac.json`，NAS 结果直接输出。

这是开发快速路径：后端依赖锁文件或 Electron 运行代码/依赖改变时会明确停止，须先使用项目正常完整打包流程更新运行环境；不会悄悄带着旧依赖部署。源码与构建产物在本机保留，部署失败直接报错，不自动回滚。
