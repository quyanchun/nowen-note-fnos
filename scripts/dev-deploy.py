#!/usr/bin/env python3
"""Small helpers for dev-deploy.sh; credentials remain outside the repository."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(*args, **kwargs):
    kwargs.setdefault("timeout", 20)
    return subprocess.check_output(args, text=True, **kwargs).strip()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def mac_check(root, app):
    if not (app / "Contents/Resources/app.asar").is_file():
        raise RuntimeError("需要已有的 Nowen Note 安装包")
    running = subprocess.run(["pgrep", "-f", "^" + re.escape(str(app)) + "/Contents/MacOS/"], capture_output=True)
    if running.returncode == 0:
        raise RuntimeError("请先退出 Nowen Note，再运行快速更新")
    if running.returncode != 1:
        raise RuntimeError("无法读取客户端进程状态，更新尚未执行")
    identity = os.environ.get("MAC_SIGN_IDENTITY", "-")
    if identity != "-" and identity not in output("security", "find-identity", "-v", "-p", "codesigning"):
        raise RuntimeError("配置的客户端签名身份不可用，更新尚未执行")
    # Runtime/dependency changes need a full desktop package, not stale modules.
    code = r'''const fs=require('fs'),p=require('path'),a=require('@electron/asar');
const root=process.argv[1],res=p.join(process.argv[2],'Contents/Resources'),arc=p.join(res,'app.asar');
const installed=JSON.parse(a.extractFile(arc,'package.json')),latest=require(p.join(root,'package.json'));
if(JSON.stringify(installed.dependencies)!==JSON.stringify(latest.dependencies)||installed.main!==latest.main)throw Error('Electron dependencies changed: build a full desktop package');
for(const n of fs.readdirSync(p.join(root,'electron'))){if(n.startsWith('builder.'))continue;const f=p.join(root,'electron',n);if(!fs.statSync(f).isFile())continue;
const old=['clipper-host.js','clipper-native-host.js'].includes(n)?fs.readFileSync(p.join(res,'clipper',n)):a.extractFile(arc,'electron/'+n);
if(!old.equals(fs.readFileSync(f)))throw Error('Electron runtime changed: build a full desktop package');}'''
    run("node", "-e", code, str(root), str(app), cwd=root)


def mac_update(root, app):
    mac_check(root, app)
    for part in ("backend", "frontend"):
        target = app / "Contents/Resources" / part / "dist"
        shutil.rmtree(target)
        shutil.copytree(root / part / "dist", target)
    info = app / "Contents/Info.plist"
    data = plistlib.loads(info.read_bytes())
    version = data["CFBundleVersion"].split(".")
    version[-1] = str(int(version[-1]) + 1)
    data["CFBundleVersion"] = ".".join(version)
    info.write_bytes(plistlib.dumps(data))
    run("codesign", "--force", "--deep", "--sign", os.environ.get("MAC_SIGN_IDENTITY", "-"), str(app))
    run("codesign", "--verify", "--deep", "--strict", str(app))
    report = {"target": "mac", "version": data["CFBundleVersion"], "hashes": {
        part: sha(app / "Contents/Resources" / part / "dist/index.js" if part == "backend"
                  else app / "Contents/Resources/frontend/dist/index.html") for part in ("backend", "frontend")}}
    (root / "dist-private/dev-deploy/mac.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)
    run("open", str(app))


def nas_update(archive, container, image, expected_sha):
    assert sha(archive) == expected_sha, "Upload checksum mismatch"
    meta = json.loads(output("docker", "inspect", container))[0]
    base = meta["Config"]["Image"]
    # Reuse native modules only when the exact backend dependency lock matches.
    lock_hash = output("docker", "exec", container, "sha256sum", "/app/backend/package-lock.json").split()[0]
    with tempfile.TemporaryDirectory(prefix="nowen-dev-") as folder:
        folder = Path(folder)
        with tarfile.open(archive) as tar:
            # fnOS can ship Python 3.11, before tarfile's extraction filter.
            for member in tar.getmembers():
                target = (folder / member.name).resolve()
                if not target.is_relative_to(folder) or not (member.isdir() or member.isfile()):
                    raise RuntimeError("Unsafe archive member")
            tar.extractall(folder)
        assert sha(folder / "backend/package-lock.json") == lock_hash, "Backend dependencies changed: build a full runtime image first"
        runtime = json.loads(output("docker", "image", "inspect", base))[0]
        metadata = ""
        # Repeated development overlays eventually exhaust OverlayFS's layer limit.
        # Flatten only the container root filesystem; mounted user data is excluded by docker export.
        if len(runtime.get("RootFS", {}).get("Layers", [])) >= 100:
            flattened = image + "-runtime"
            producer = subprocess.Popen(["docker", "export", container], stdout=subprocess.PIPE)
            try:
                run("docker", "import", "-", flattened, stdin=producer.stdout, timeout=180)
            finally:
                producer.stdout.close()
            if producer.wait(timeout=30) != 0:
                raise RuntimeError("Runtime flatten failed before application replacement")
            config = runtime["Config"]
            for entry in config.get("Env") or []:
                key, value = entry.split("=", 1)
                assert re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key)
                metadata += "ENV " + key + "=" + json.dumps(value).replace("$", "\\$") + "\n"
            if config.get("WorkingDir"):
                metadata += "WORKDIR " + json.dumps(config["WorkingDir"]) + "\n"
            if config.get("User"):
                assert re.fullmatch(r"[A-Za-z0-9_.:-]+", config["User"])
                metadata += "USER " + config["User"] + "\n"
            if config.get("Entrypoint"):
                metadata += "ENTRYPOINT " + json.dumps(config["Entrypoint"]) + "\n"
            health = config.get("Healthcheck") or {}
            if health.get("Test") and health["Test"][0] != "NONE":
                options = " ".join("--" + flag + "=" + str(health[key]) + unit for key, flag, unit in [
                    ("Interval", "interval", "ns"), ("Timeout", "timeout", "ns"),
                    ("StartPeriod", "start-period", "ns"), ("Retries", "retries", "")
                ] if health.get(key))
                test = health["Test"]
                command = json.dumps(test[1:]) if test[0] == "CMD" else test[1]
                if "\n" in command:
                    raise RuntimeError("Unsupported multiline health check")
                metadata += "HEALTHCHECK " + options + " CMD " + command + "\n"
            base = flattened
            print("Runtime flattened; mounted application data preserved", flush=True)
        (folder / "Dockerfile").write_text(
            f"FROM {base}\n" + metadata + "RUN rm -rf /app/backend/dist /app/frontend/dist\n"
            "COPY backend/dist /app/backend/dist\nCOPY frontend/dist /app/frontend/dist\n"
            'CMD ["node", "/app/backend/dist/index.js"]\n')
        run("docker", "build", "--pull=false", "--tag", image, str(folder))
        labels = meta["Config"]["Labels"]
        compose = Path(labels["com.docker.compose.project.config_files"])
        uid, gid = meta["Config"]["User"].split(":")
        mounts = {item["Destination"]: item["Source"] for item in meta["Mounts"]}
        env = dict(os.environ, TRIM_UID=uid, TRIM_GID=gid,
                   TRIM_DATA_SHARE_PATHS=mounts["/app/data"], TRIM_APPDEST=mounts["/app/fnos"])
        command = ["docker", "compose", "--project-name", labels["com.docker.compose.project"], "--file", str(compose)]
        before = json.loads(output(*command, "config", "--format", "json", env=env))
        text = compose.read_text()
        declared_image = before["services"][labels["com.docker.compose.service"]]["image"]
        assert text.count(declared_image) == 1, "Unexpected Compose image declaration"
        replacement = text.replace(declared_image, image, 1)
        compose.write_text(replacement)
        after = json.loads(output(*command, "config", "--format", "json", env=env))
        before["services"][labels["com.docker.compose.service"]]["image"] = image
        assert after == before, "Only the app image may change"
        run(*command, "up", "--detach", "--no-deps", "--pull", "never", labels["com.docker.compose.service"], env=env)
        for _ in range(60):
            installed = json.loads(output("docker", "inspect", container))[0]
            if installed["State"].get("Health", {}).get("Status") == "healthy":
                break
            time.sleep(1)
        else:
            raise RuntimeError("NAS app did not become healthy")
        if output("appcenter-cli", "status", container) != "running":
            run("appcenter-cli", "start", container, timeout=30)
        expected = [sha(folder / "backend/dist/index.js"), sha(folder / "frontend/dist/index.html")]
        actual = [line.split()[0] for line in output("docker", "exec", container, "sha256sum", "/app/backend/dist/index.js", "/app/frontend/dist/index.html").splitlines()]
        assert actual == expected, "Installed resources differ from current build"
        assert installed["Config"]["Image"] == image
        print(json.dumps({"target": "nas", "image": image, "imageId": installed["Image"],
                          "health": "healthy", "appStatus": output("appcenter-cli", "status", container),
                          "hashes": actual}), flush=True)


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    if mode == "nas":
        nas_update(Path(args[0]).resolve(), *args[1:])
    elif mode == "mac-check":
        mac_check(*map(Path, args))
    elif mode == "mac":
        mac_update(*map(Path, args))
    else:
        raise SystemExit("Use dev-deploy.sh")
