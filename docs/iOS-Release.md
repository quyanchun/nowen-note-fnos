# iOS 发布指南（无 Mac 方案）

> 适用于：Windows/Linux 开发者，想把 `nowen-note` 发到 App Store/TestFlight，但**没有 Mac 设备**。
>
> 整体思路：**全部代码在 Windows 写，构建/签名/上传由 GitHub Actions 的 macOS runner 完成。**

---

## 一次性前置准备（约 1-3 个工作日，主要在等 Apple 审核）

### 1. 注册 Apple Developer Program（$99/年，必交）

- 个人账号：https://developer.apple.com/programs/enroll/
- 国内卡可付，需要本人身份证 + 实名手机号
- **不需要邓白氏号**（邓白氏号只针对企业账号）
- 审核 1-3 天，期间可以跳到第 2 步同步进行

### 2. 创建 App ID（在 https://developer.apple.com/account 网页操作，无需 Mac）

- Identifiers → `+` → App IDs → App
- Bundle ID 填 **`com.nowen.note`**（必须和 `frontend/capacitor.config.ts` 的 `appId` 一致）
- Capabilities 至少勾选 Push Notifications（如果将来要推送）；其余按需

### 3. 创建签名证书（推荐：fastlane match，全自动；备选：Apple Configurator 手动）

#### 推荐方案：fastlane match（无 Mac 也能运行）

`fastlane match` 会把证书加密后存到一个私有 Git 仓库，CI 直接拉就行——这是 Apple 没 Mac 的最佳实践。

```bash
# 在任意机器（Windows / Linux 都行，需要装 Ruby）：
gem install fastlane
mkdir certs-storage && cd certs-storage && git init  # 这个仓库要 private！

# 在 frontend/ios/App/ 下：
cd frontend/ios/App
bundle init && bundle add fastlane
bundle exec fastlane match init     # 选 git，填上面那个 private repo URL
bundle exec fastlane match appstore # 自动生成 Distribution 证书 + Provisioning Profile
```

> 第一次运行 `match` 会要你登录 Apple ID（含 2FA），有点折腾但只需做一次。
>
> 之后 CI 跑 `match appstore --readonly` 就能复用，不会重复创建证书。

#### 备选方案：手动生成（需要找朋友借 Mac 半小时）

不展开，参考 https://developer.apple.com/help/account/create-certificates/

### 4. 生成 App Store Connect API Key（重要：纯网页操作，无需 Mac）

- 打开 https://appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API
- 点 `+` 创建一个 Key
- **Access** 选 `App Manager`（够用，不需要 Admin）
- 创建后立即下载 `.p8` 文件（**只能下载一次！丢了只能删 key 重建**）
- 记下：
  - Issuer ID（页面顶部，UUID 格式）
  - Key ID（10 位字符串，例如 `2X9Y8WABCD`）
  - .p8 文件内容（含 `-----BEGIN PRIVATE KEY-----`）

### 5. 把证书 / Profile 转成 base64（在 Windows PowerShell 或 Git Bash 跑）

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\Downloads\Distribution.p12")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\Downloads\AppStore.mobileprovision")) | Set-Clipboard
```

```bash
# Git Bash / WSL
base64 -w0 ~/Downloads/Distribution.p12        # 复制输出
base64 -w0 ~/Downloads/AppStore.mobileprovision # 复制输出
```

### 6. 在 GitHub 仓库填 Secrets

`Settings → Secrets and variables → Actions → New repository secret`，依次添加：

| Secret 名 | 值 |
|---|---|
| `IOS_CERTIFICATE_BASE64` | 第 5 步 .p12 的 base64 |
| `IOS_CERTIFICATE_PASSWORD` | 导出 .p12 时设的密码 |
| `IOS_PROVISIONING_PROFILE_BASE64` | 第 5 步 .mobileprovision 的 base64 |
| `IOS_KEYCHAIN_PASSWORD` | 任意复杂字符串（CI 内部用，不外传） |
| `APPSTORE_ISSUER_ID` | 第 4 步的 Issuer UUID |
| `APPSTORE_API_KEY_ID` | 第 4 步的 Key ID |
| `APPSTORE_API_PRIVATE_KEY` | 第 4 步 .p8 文件**完整原文**（含 BEGIN/END 行） |

---

## 日常发版流程（每次发 iOS 都走这套）

### 方式 1：打 git tag（自动触发）

```bash
# 触发 PC + Android 用：
git tag v1.0.33 && git push origin v1.0.33

# 只触发 iOS（避开 PC/Android 重复构建）：
git tag v1.0.33-ios && git push origin v1.0.33-ios
```

### 方式 2：手动触发（适合首次调试）

GitHub 仓库 → Actions → `iOS Build & TestFlight` → Run workflow → 选择 `upload: true`

### 构建时长参考

- macos-14 runner：**约 15-25 分钟**（前端 build 3min + cap sync 1min + pod install 4min + xcodebuild archive 8min + altool upload 3min）
- 失败重试在 Actions UI 直接 Re-run 即可，不消耗额外配额

### 上传后

1. App Store Connect → My Apps → TestFlight
2. 等 Apple 处理（通常 5-15 分钟，处理完会发邮件）
3. 邀请内部测试员（最多 100 个 Apple ID，无需审核）；外部测试员需要先过 TestFlight 审核（24-48h）
4. 正式上架审核：在 App Store 标签页提交版本，审核 1-3 天

---

## 常见问题排查

### Q1: `Skipping pod install because CocoaPods is not installed`

本地 Windows 跑 `npx cap sync ios` 必然报这个，**正常现象**——CocoaPods 是 Ruby 包，CI 的 macOS runner 自带，本地不需要装。

### Q2: `xcodebuild: error: No profiles for 'com.nowen.note' were found`

Provisioning Profile 的 Bundle ID 跟 `capacitor.config.ts` 不一致。检查 Apple Developer 后台的 App ID 与 Profile 关联是否正确。

### Q3: `Code signing is required for product type 'Application' in SDK 'iOS'`

证书 .p12 没正确导入 keychain。常见原因：`IOS_CERTIFICATE_PASSWORD` 错了，或者 base64 在 Windows 复制时混入了换行/空格——重新编码时务必用 `base64 -w0`（无换行）。

### Q4: TestFlight 上传后一直 Processing

Apple 后端慢，正常 5-15 分钟。如果超过 1 小时仍 Processing，去 App Store Connect → Activity 看具体错误（通常是缺 Privacy Manifest 或 Export Compliance）。

### Q5: 没有 Mac，怎么真机调试 iOS？

两条路：
1. **TestFlight 内测包**：每次推送 tag 后 15 分钟，iPhone 装 TestFlight App 直接装包测试
2. **远程 macOS**：MacinCloud $1/小时按次租，或 MacStadium 月租；只在调原生 bug 时才需要

---

## 与 release.sh 的整合（可选，进阶）

`scripts/release.sh` 选项 5（一键全量）目前只覆盖 docker/pc/android/fpk/lite/clipper 6 个 target，**故意不包含 iOS**——因为 iOS 走 GitHub Actions 异步构建，不像 docker buildx 那样能在本地一条命令搞定。

如果你想让 release.sh 选项 5 也触发 iOS：在脚本的 `git push tag` 步骤之后，**额外推一个 `-ios` tag** 即可（已在 `.github/workflows/ios-release.yml` 里支持 `v*.*.*` 主 tag 触发，所以**其实啥都不用改**——主 tag 一推，PC/Android/iOS 三套 workflow 同时启动）。
