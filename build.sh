#!/bin/bash
set -e

cd "$(dirname "$0")"

# Extract build info
APP_VERSION=$(node -p "require('./electron/package.json').version")
BUILD_NUMBER=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "==> Cipher v${APP_VERSION} (build ${BUILD_NUMBER})"
echo "    ${BUILD_DATE}"
echo ""

# Write build-info.json for the Electron app to read at runtime
cat > electron/build-info.json <<BINFO
{
  "version": "${APP_VERSION}",
  "buildNumber": "${BUILD_NUMBER}",
  "buildDate": "${BUILD_DATE}"
}
BINFO

# Kill running Cipher app before build
if pgrep -x "Cipher" > /dev/null 2>&1; then
    echo "==> Closing Cipher..."
    osascript -e 'quit app "Cipher"'
    sleep 1
    # Force kill if it didn't quit gracefully
    if pgrep -x "Cipher" > /dev/null 2>&1; then
        pkill -x "Cipher"
        sleep 1
    fi
fi

echo "==> Building backend..."
cd backend
go build -o backend .
cd ..

echo "==> Building frontend..."
cd frontend
npm run build
cd ..

echo "==> Building Electron app..."
cd electron
npm run build
cd ..

echo "==> Re-signing app..."
codesign --force --sign - "/Applications/Cipher.app/Contents/Resources/backend"
codesign --deep --force --sign - "/Applications/Cipher.app"

echo ""
echo "==> Done! Cipher.app installed to /Applications/"
echo "    Version: v${APP_VERSION}"
echo "    Build:   ${BUILD_NUMBER}"
echo "    Date:    ${BUILD_DATE}"
