#!/bin/sh
# 发版后刷新 brew tap:用本地 release/ 的 dmg 算 sha256,渲染 cask,push 到 monkeychen/homebrew-wx-kit。
# 用法:scripts/update-brew-tap.sh <version>   (如 0.5.5;需 gh 已登录、release/ 有对应 dmg)
# 网络规约:gh/git 推 github 一律直连(unset 代理)。
set -e
V="$1"
[ -n "$V" ] || { echo "usage: $0 <version>" >&2; exit 2; }
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# sha256 一律以 GitHub Release 已发布资产为准——本地 release/ 会被后续 build 重写,
# 与已发布文件不逐字节一致(v0.5.5 实测踩坑:本地重建后 hash 漂了)。
echo "downloading published assets of v$V to hash..."
gh release download "v$V" --repo monkeychen/wx-kit --dir "$TMP/assets" \
  --pattern "wx-kit-$V-arm64.dmg" --pattern "wx-kit-$V.dmg"
SHA_ARM=$(shasum -a 256 "$TMP/assets/wx-kit-$V-arm64.dmg" | cut -d' ' -f1)
SHA_X64=$(shasum -a 256 "$TMP/assets/wx-kit-$V.dmg" | cut -d' ' -f1)
git clone --depth 1 "git@github.com:monkeychen/homebrew-wx-kit.git" "$TMP/tap"
mkdir -p "$TMP/tap/Casks"
cat > "$TMP/tap/Casks/wx-kit.rb" <<CASK
cask "wx-kit" do
  version "$V"

  on_arm do
    sha256 "$SHA_ARM"
    url "https://github.com/monkeychen/wx-kit/releases/download/v#{version}/wx-kit-#{version}-arm64.dmg"
  end
  on_intel do
    sha256 "$SHA_X64"
    url "https://github.com/monkeychen/wx-kit/releases/download/v#{version}/wx-kit-#{version}.dmg"
  end

  name "wx-kit"
  desc "微信百宝箱 — 微信公众号文章下载器(GUI + agent 友好 CLI)"
  homepage "https://github.com/monkeychen/wx-kit"

  app "wx-kit.app"

  caveats <<~EOS
    应用未签名,安装后先清 quarantine(否则 GUI 被拦、CLI 调用会挂起):
      xattr -cr #{appdir}/wx-kit.app
    (GUI 也可走「系统设置 → 隐私与安全性」→「仍要打开」放行)
    命令行入口(供 AI agent):首次打开 GUI 会引导创建 ~/bin/wx-kit。
  EOS
end
CASK
cd "$TMP/tap"
git add Casks/wx-kit.rb
git -c user.name=monkeychen -c user.email=cza55008@gmail.com commit -m "wx-kit $V" >/dev/null
git push origin HEAD
echo "tap updated to $V (arm64 $SHA_ARM / x64 $SHA_X64)"
