#!/usr/bin/env node
/**
 * 绿联 UGOS Pro upk 一键打包脚本
 *
 * 用法（PowerShell）：
 *   node scripts/upk/build-upk.mjs
 *   node scripts/upk/build-upk.mjs --build 1 --arch amd64
 *
 * 默认行为：
 *   - 版本号取自 package.json
 *   - 默认两个架构都打：amd64、arm64
 *   - 镜像优先从本机 docker daemon 中查找 nowen-note:<version> / nowen-note:v<version> / nowen-note:latest
 *     的 amd64 / arm64 manifest，docker save 出 tar；找不到则**跳过**该架构并提示
 *   - 调用项目根目录的 ugcli.exe 执行 pack
 *
 * 可选环境变量 / 参数：
 *   --version <x.y.z>   覆盖版本号（默认 package.json.version）
 *   --build <n>         构建号，传给 ugcli pack --build，默认 1
 *   --arch all|amd64|arm64   要打的架构，默认 all
 *   --image <repo:tag>  自定义镜像名（覆盖默认 nowen-note:<version>）
 *   --pull              本地找不到镜像时自动 docker pull
 *   --keep-images       保留 rootfs_<arch>/images/*.tar（默认打完就清，避免 git add）
 *
 *   环境变量（与 scripts/release.sh 对接）：
 *     UPK_IMAGE_REF       覆盖镜像名（同 --image，优先级低于命令行）
 *     UPK_BUILD_NO        构建号（同 --build）
 *     DOCKERHUB_REPO      DockerHub 仓库名（如 cropflre/nowen-note），
 *                          会拼成 ${DOCKERHUB_REPO}:v${VERSION} 加入候选镜像列表
 *     UGCLI_BIN           ugcli 可执行文件路径，默认根目录 ugcli.exe / ugcli
 */
import { execSync, spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const TEMPLATE_DIR = join(__dirname, 'template');

// ---------- 解析参数 ----------
function arg(name, def = undefined) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return def;
    const v = process.argv[i + 1];
    if (!v || v.startsWith('--')) return true;
    return v;
}

const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
const VERSION = String(arg('version', pkg.version));
const BUILD_NO = String(arg('build', process.env.UPK_BUILD_NO || '1'));
const ARCH = String(arg('arch', 'all')); // all | amd64 | arm64
const IMAGE_REF_RAW = String(
    arg('image', process.env.UPK_IMAGE_REF || `nowen-note:${VERSION}`),
);
const DOCKERHUB_REPO = process.env.DOCKERHUB_REPO || '';
const AUTO_PULL = arg('pull', false) === true;
const KEEP_IMAGES = arg('keep-images', false) === true;

// 检测 ref 是否是 "repo:" 或 "repo:v" 这种 tag 残缺的写法
// 正常 tag 至少 2 个字符（v1 / latest / dev / 1.0 ...），
// 单独的 v/V 几乎可以确定是把 v${VERSION} 写漏了版本号
function isBrokenRef(ref) {
    const idx = ref.lastIndexOf(':');
    if (idx === -1) return false; // 没冒号 = 用 latest，合法
    // 注意 registry 端口号也含冒号，如 host:5000/repo —— 这种冒号后没有 /，应认为不是 tag
    const tag = ref.slice(idx + 1);
    if (tag.includes('/')) return false; // host:port/xxx
    if (tag.length === 0) return true;
    if (tag.length < 2 && /^[vV]?$/.test(tag)) return true;
    return false;
}
if (isBrokenRef(IMAGE_REF_RAW)) {
    console.error(
        `[upk] 错误：镜像 ref "${IMAGE_REF_RAW}" 看起来 tag 残缺（很可能是漏写了版本号，例如 ":v" 应为 ":v${VERSION}"）`,
    );
    console.error(
        `[upk]      请用 --image <repo:tag> 或 UPK_IMAGE_REF 显式指定，或者直接 unset UPK_IMAGE_REF 让脚本回退到 nowen-note:${VERSION}`,
    );
    process.exit(1);
}
const IMAGE_REF = IMAGE_REF_RAW;

const ARCH_LIST =
    ARCH === 'all' ? ['amd64', 'arm64'] : ARCH === 'amd64' ? ['amd64'] : ARCH === 'arm64' ? ['arm64'] : null;
if (!ARCH_LIST) {
    console.error(`[upk] 错误：--arch 只能是 all | amd64 | arm64，实际收到 ${ARCH}`);
    process.exit(1);
}

const OUT_DIR = resolve(PROJECT_ROOT, 'dist-upk');
const WORK_DIR = join(OUT_DIR, `nowen-note-${VERSION}`);

console.log(`[upk] 版本: ${VERSION}  构建号: ${BUILD_NO}  架构: ${ARCH_LIST.join(',')}`);
console.log(`[upk] 镜像: ${IMAGE_REF}`);

// ---------- 1. 工作目录 ----------
mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });

// ---------- 2. 拷模板 ----------
console.log('[upk] 复制模板');
cpSync(TEMPLATE_DIR, WORK_DIR, { recursive: true });

// 注入 project.yaml 的 VERSION 和支持架构列表
const archLines = ARCH_LIST.map((a) => `  - ${a}`).join('\n');
const projectYamlPath = join(WORK_DIR, 'project.yaml');
let py = readFileSync(projectYamlPath, 'utf8');
py = py.replace(/{{VERSION}}/g, VERSION).replace(/{{SUPPORT_ARCH_LIST}}/g, archLines);
writeFileSync(projectYamlPath, py);

// 注入 docker-compose.yaml 的 IMAGE
const composePath = join(WORK_DIR, 'rootfs_common', 'docker-compose.yaml');
let cy = readFileSync(composePath, 'utf8');
cy = cy.replace(/{{IMAGE}}/g, IMAGE_REF);
writeFileSync(composePath, cy);

// ---------- 3. 图标 ----------
const SRC_ICON = join(PROJECT_ROOT, 'electron', 'icon.png');
if (!existsSync(SRC_ICON)) {
    console.error(`[upk] 错误：找不到源图标 ${SRC_ICON}`);
    process.exit(1);
}
console.log('[upk] 生成 256x256 图标');
await sharp(SRC_ICON).resize(256, 256).png().toFile(join(WORK_DIR, 'rootfs_common', 'icon.png'));

// ---------- 4. 准备各架构镜像 tar ----------
function dockerOk() {
    const r = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], { stdio: 'ignore' });
    return r.status === 0;
}
if (!dockerOk()) {
    console.error('[upk] 错误：未检测到可用的 docker，无法 docker save 镜像');
    process.exit(1);
}

function imageArch(ref) {
    // 返回 'amd64' / 'arm64' / null
    const r = spawnSync('docker', ['image', 'inspect', '--format', '{{.Architecture}}', ref], {
        encoding: 'utf8',
    });
    if (r.status !== 0) return null;
    return r.stdout.trim() || null;
}

function dockerPull(ref, platform) {
    console.log(`[upk]   docker pull --platform ${platform} ${ref}`);
    const r = spawnSync('docker', ['pull', '--platform', platform, ref], { stdio: 'inherit' });
    return r.status === 0;
}

function saveImage(ref, outTar) {
    console.log(`[upk]   docker save -o ${outTar} ${ref}`);
    const r = spawnSync('docker', ['save', '-o', outTar, ref], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`docker save 失败: ${ref}`);
}

const realArchList = [];
for (const a of ARCH_LIST) {
    const archDir = join(WORK_DIR, `rootfs_${a}`, 'images');
    mkdirSync(archDir, { recursive: true });

    // 候选镜像：用户指定的 IMAGE_REF（默认 nowen-note:<version>），
    // 以及它的几个常见 arch 后缀变体；逐一查 architecture 字段
    const candidates = [
        IMAGE_REF,
        `${IMAGE_REF}-${a}`,
        `nowen-note:${VERSION}-${a}`,
        `nowen-note:${a}-${VERSION}`,
        `nowen-note:${a}`,
    ];
    if (DOCKERHUB_REPO) {
        // release.sh 推送的镜像 tag 是 v${VERSION} + latest
        candidates.push(
            `${DOCKERHUB_REPO}:v${VERSION}`,
            `${DOCKERHUB_REPO}:${VERSION}`,
            `${DOCKERHUB_REPO}:v${VERSION}-${a}`,
        );
    }
    // 去重 + 过滤掉 tag 残缺的 ref（防御 isBrokenRef 漏网或拼接产物本身就坏）
    const uniqCandidates = [...new Set(candidates)].filter((c) => !isBrokenRef(c));
    const platform = `linux/${a}`;
    let picked = null;
    for (const c of uniqCandidates) {
        const ia = imageArch(c);
        if (ia === a) {
            picked = c;
            break;
        }
    }
    if (!picked && AUTO_PULL) {
        // 本地全部找不到，按候选顺序尝试 docker pull --platform linux/<arch>
        // 注意：必须用 --platform 强制指定架构，否则 docker pull 默认拉本机架构
        for (const c of uniqCandidates) {
            if (dockerPull(c, platform) && imageArch(c) === a) {
                picked = c;
                break;
            }
        }
    }
    if (!picked) {
        console.warn(
            `[upk] 警告：本机 docker 中找不到 ${a} 架构的镜像（已尝试：${uniqCandidates.join(', ')}），跳过 ${a}`,
        );
        console.warn(
            `[upk]      可用方案：① 加 --pull 自动拉 ② 手动 docker buildx build --platform ${platform} -t nowen-note:${VERSION} --load .`,
        );
        // 把空目录删掉，避免 ugcli check 报"images 下没有 tar"
        try {
            rmSync(join(WORK_DIR, `rootfs_${a}`), { recursive: true, force: true });
        } catch {
            /* ignore */
        }
        continue;
    }
    const tarName = `nowen-note-${VERSION}-${a}.tar`;
    // ugcli check 会交叉验证 tar 内嵌的 RepoTag 与 docker-compose.yaml 的 image 字段是否一致。
    // picked 可能是 cropflre/nowen-note:v1.1.6-amd64（带架构后缀），
    // 而 compose 里写的是 IMAGE_REF（不带后缀）——不一致会被 check 拦下。
    // 这里 save 前先 retag 到 IMAGE_REF，让 tar 里的 RepoTag 与 compose 对齐。
    // 多架构之间会覆盖同一个 tag，但无所谓：每个架构的 tar 在这一轮循环里
    // 已经落地。虚奇贵 NAS 部署时只 load 本机架构那一份。
    if (picked !== IMAGE_REF) {
        console.log(`[upk]   docker tag ${picked} ${IMAGE_REF}`);
        const tagRet = spawnSync('docker', ['tag', picked, IMAGE_REF], { stdio: 'inherit' });
        if (tagRet.status !== 0) throw new Error(`docker tag 失败: ${picked} -> ${IMAGE_REF}`);
    }
    saveImage(IMAGE_REF, join(archDir, tarName));
    realArchList.push(a);
}

if (realArchList.length === 0) {
    console.error('[upk] 错误：没有任何架构的镜像可打包');
    process.exit(1);
}

// 重新写一次 project.yaml 的 support_arch（按真实可用的）
const realArchLines = realArchList.map((a) => `  - ${a}`).join('\n');
let py2 = readFileSync(projectYamlPath, 'utf8');
py2 = py2.replace(/support_arch:\n[\s\S]*?(?=\n[a-zA-Z_]+:)/, `support_arch:\n${realArchLines}\n`);
writeFileSync(projectYamlPath, py2);

// ---------- 5. 调 ugcli ----------
function findUgcli() {
    const env = process.env.UGCLI_BIN;
    if (env && existsSync(env)) return env;
    const candidates = [
        join(PROJECT_ROOT, 'ugcli.exe'),
        join(PROJECT_ROOT, 'ugcli'),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    return null;
}
const UGCLI = findUgcli();
if (!UGCLI) {
    console.error('[upk] 错误：找不到 ugcli 可执行文件，请放到项目根目录或设置 UGCLI_BIN');
    process.exit(1);
}
console.log(`[upk] 使用 ugcli: ${UGCLI}`);
// 从 Windows 处同步过来的 ugcli 二进制可能丢失可执行位，会表现为
// "Permission denied"——但 spawnSync 会拿到个错误退出码，在上层被误会为 check 失败。
// 这里主动补上 +x，并口子个复发。
if (process.platform !== 'win32') {
    try {
        execSync(`chmod +x "${UGCLI}"`);
    } catch {
        /* 未付予权限也不阻断后续，spawnSync 如果真的不能运行会报原始错误 */
    }
}

console.log('[upk] ugcli check');
const checkRet = spawnSync(UGCLI, ['check', '--path', WORK_DIR], { stdio: 'inherit' });
if (checkRet.status !== 0) {
    console.error('[upk] ugcli check 失败，先修复上述报错再重试');
    process.exit(1);
}

const packArch = ARCH_LIST.length === 1 ? ARCH_LIST[0] : 'all';
console.log(`[upk] ugcli pack --build ${BUILD_NO} --arch ${packArch}`);
const packRet = spawnSync(UGCLI, ['pack', '--build', BUILD_NO, '--arch', packArch], {
    stdio: 'inherit',
    cwd: WORK_DIR,
});
if (packRet.status !== 0) {
    console.error('[upk] ugcli pack 失败');
    process.exit(1);
}

// ---------- 6. 找产物 ----------
// ugcli 实际把 .upk 写到 build_dir/pkgs/upk/<arch>_<app_id>_<ver>.<build>.upk，
// 不同版本/工具链可能换路径（build_dir / build / pkgs/upk / ...），所以这里直接
// 递归扫整个 WORK_DIR + OUT_DIR，找全所有 .upk，简单暴力但稳。
function listUpksRecursive(dir, acc = []) {
    if (!existsSync(dir)) return acc;
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        let st;
        try {
            st = statSync(p);
        } catch {
            continue;
        }
        if (st.isDirectory()) listUpksRecursive(p, acc);
        else if (name.toLowerCase().endsWith('.upk')) acc.push(p);
    }
    return acc;
}
const found = [...listUpksRecursive(WORK_DIR), ...listUpksRecursive(OUT_DIR)];
// found 里同一个文件可能被收两次：OUT_DIR 通常是 WORK_DIR 的父目录
// （dist-upk/ 与 dist-upk/nowen-note-1.1.6/），递归会把同一路径扫两遍。
// 必须在 cp/rm 之前按真实路径 dedupe，否则第二轮会 lstat 已删源文件 ENOENT。
const foundUniq = [];
const srcSeen = new Set();
for (const p of found) {
    const k = resolve(p);
    if (srcSeen.has(k)) continue;
    srcSeen.add(k);
    foundUniq.push(p);
}
const moved = [];
const seen = new Set();
for (const src of foundUniq) {
    const dst = join(OUT_DIR, basename(src));
    if (resolve(src) !== resolve(dst)) {
        cpSync(src, dst);
        rmSync(src, { force: true });
    }
    const key = resolve(dst);
    if (seen.has(key)) continue;
    seen.add(key);
    moved.push(dst);
}
if (moved.length === 0) {
    console.warn('[upk] 没找到 .upk 产物，请手动检查 dist-upk/');
} else {
    for (const f of moved) {
        const sz = (statSync(f).size / 1024 / 1024).toFixed(2);
        console.log(`[upk] 产物: ${f}  (${sz} MB)`);
    }
}

// ---------- 7. 清理大块 tar（默认开启） ----------
if (!KEEP_IMAGES) {
    for (const a of realArchList) {
        const d = join(WORK_DIR, `rootfs_${a}`, 'images');
        try {
            for (const f of readdirSync(d)) {
                if (f.toLowerCase().endsWith('.tar')) rmSync(join(d, f), { force: true });
            }
        } catch {
            /* ignore */
        }
    }
}

console.log('');
console.log(`[upk] 完成。输出目录：${OUT_DIR}`);
console.log('[upk] 安装方式：把 .upk 文件传到绿联 NAS 管理员的「我的文件」，');
console.log('              在「应用中心 → 设置 → 本地安装」中选择该文件即可。');
