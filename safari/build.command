#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
python3 prepare.py
project='Project/PhotoShow Safari/PhotoShow Safari.xcodeproj'
if [[ ! -d "$project" ]]; then
  xcrun safari-web-extension-converter WebExtension --project-location Project --app-name 'PhotoShow Safari' --bundle-identifier com.anaheim.photoshow.safari --swift --macos-only --copy-resources --no-open --no-prompt
  python3 prepare.py
fi
xcodebuild -quiet -project "$project" -scheme 'PhotoShow Safari' -configuration Release -derivedDataPath build -destination 'generic/platform=macOS' ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build
mkdir -p dist
ditto 'build/Build/Products/Release/PhotoShow Safari.app' 'dist/PhotoShow Safari.app'
codesign --verify --deep --strict 'dist/PhotoShow Safari.app'
print "Built: $PWD/dist/PhotoShow Safari.app"
