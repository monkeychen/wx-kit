#!/bin/sh
# 核实 brew 渠道是否发对了——**零下载**(不拉 dmg)。
# 用法:scripts/verify-brew-tap.sh <version>    (如 0.8.1;需 gh 已登录)
#
# 为什么不再「装一遍」验:
#   cask 每版只变 version + sha256,安装行为(app 名、装到 /Applications、caveats)由模板固定,
#   与版本无关;而 app 本身的行为该用**本地 build 产物**验,不必绕一圈从 GitHub 拉回来
#   ——那个 dmg 就是我们自己上传的。真正要核实的是「cask 元数据是否指向正确的已发布资产」,
#   这三件事全部可以零下载完成(v0.8.1 起;此前每次发版要拉 280MB,国内直连常卡死)。
set -e
V="$1"
[ -n "$V" ] || { echo "usage: $0 <version>" >&2; exit 2; }
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
REPO=monkeychen/wx-kit
FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }

# 本地 tap clone 的 remote 是 https,本机 https 直连 github 常超时 → 用 ssh 刷新
TAP=$(brew --repository "$REPO" 2>/dev/null) || { echo "tap not installed" >&2; exit 2; }
echo "refreshing local tap clone (ssh)..."
git -C "$TAP" fetch -q git@github.com:monkeychen/homebrew-wx-kit.git main
git -C "$TAP" reset -q --hard FETCH_HEAD
CASK="$TAP/Casks/wx-kit.rb"

echo "checking cask against the published release..."
ruby -c "$CASK" >/dev/null 2>&1 && ok "cask 语法合法" || bad "cask 语法错误"

CASK_V=$(sed -n 's/^  version "\(.*\)"/\1/p' "$CASK")
[ "$CASK_V" = "$V" ] && ok "cask version = $V" || bad "cask version = $CASK_V(期望 $V)"

API=$(gh api "repos/$REPO/releases/tags/v$V")

check_asset() {   # $1=资产名  $2=cask 里该架构的 sha256
  digest=$(printf '%s' "$API" | python3 -c "
import json,sys
d=json.load(sys.stdin)
a=[x for x in d['assets'] if x['name']=='$1']
print((a[0].get('digest') or '').replace('sha256:',''), a[0]['browser_download_url'] if a else '', sep='\t') if a else print('\t')
")
  sha=$(printf '%s' "$digest" | cut -f1)
  url=$(printf '%s' "$digest" | cut -f2)
  [ -n "$sha" ] || { bad "$1:release 里没有这个资产(或 API 未给 digest)"; return; }
  [ "$sha" = "$2" ] && ok "$1 sha256 与已发布资产一致" || bad "$1 sha256 不符(cask=$2 / 实际=$sha)"
  # cask 的 url 用 #{version} 插值,渲染后应与 API 给的下载地址逐字相同
  rendered=$(grep -o 'https://github.com/[^"]*' "$CASK" | sed "s/#{version}/$V/g" | grep -F "$1" | head -1)
  [ "$rendered" = "$url" ] && ok "$1 url 指向该资产" || bad "$1 url 不符(cask=$rendered / 实际=$url)"
}

SHA_ARM=$(awk '/on_arm/,/end/' "$CASK" | sed -n 's/.*sha256 "\(.*\)".*/\1/p')
SHA_X64=$(awk '/on_intel/,/end/' "$CASK" | sed -n 's/.*sha256 "\(.*\)".*/\1/p')
check_asset "wx-kit-$V-arm64.dmg" "$SHA_ARM"
check_asset "wx-kit-$V.dmg" "$SHA_X64"

BREW_V=$(brew info --cask wx-kit 2>/dev/null | sed -n '1s/.*: *//p')
[ "$BREW_V" = "$V" ] && ok "brew info --cask 报告 $V(用户侧读到的就是它)" || bad "brew info 报告 $BREW_V"

[ "$FAIL" = 0 ] && echo "brew 渠道核实通过(零下载)" || { echo "brew 渠道核实失败" >&2; exit 1; }
