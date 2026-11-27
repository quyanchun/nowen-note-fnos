const { execFileSync } = require("node:child_process");
const { mkdirSync, realpathSync } = require("node:fs");
const path = require("node:path");

function build(directory) {
  const headers = path.resolve(path.dirname(realpathSync(process.execPath)), "../include/node");
  mkdirSync(directory, { recursive: true });
  execFileSync("xcrun", ["clang", "-bundle", "-fobjc-arc", "-arch", "arm64", "-arch", "x86_64",
    "-mmacosx-version-min=11.0", "-framework", "AppKit", "-framework", "QuartzCore", "-undefined", "dynamic_lookup",
    "-I", headers, path.join(__dirname, "native/quick-panel-corners.m"), "-o", path.join(directory, "quick-panel-corners.node")], { stdio: "inherit" });
}

exports.afterPack = context => {
  if (context.electronPlatformName === "darwin") build(path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app", "Contents/Resources"));
};
if (require.main === module && process.platform === "darwin") build(path.join(__dirname, "../node_modules/.cache/nowen"));
