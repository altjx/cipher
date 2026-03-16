#!/bin/bash
# Patches the local Electron.app bundle to show "Android Messages" in macOS
set -e

ELECTRON_APP="node_modules/electron/dist/Electron.app"
RENAMED_APP="node_modules/electron/dist/Android Messages.app"

# Determine which bundle exists
if [ -d "$RENAMED_APP" ]; then
  APP_DIR="$RENAMED_APP"
elif [ -d "$ELECTRON_APP" ]; then
  APP_DIR="$ELECTRON_APP"
else
  echo "Error: No Electron.app bundle found" >&2
  exit 1
fi

PLIST="$APP_DIR/Contents/Info.plist"

# Patch Info.plist (name, identifier, and icon)
/usr/libexec/PlistBuddy \
  -c 'Set :CFBundleName "Android Messages"' \
  -c 'Set :CFBundleDisplayName "Android Messages"' \
  -c 'Set :CFBundleIdentifier "com.android-messages"' \
  -c 'Set :CFBundleIconFile "icon.icns"' \
  "$PLIST" 2>/dev/null || true

# Copy custom icon into the bundle's Resources (both names for safety)
RESOURCES_DIR="$APP_DIR/Contents/Resources"
cp "assets/icon.icns" "$RESOURCES_DIR/icon.icns"
cp "assets/icon.icns" "$RESOURCES_DIR/electron.icns"

# Rename the .app bundle if not already renamed
if [ "$APP_DIR" = "$ELECTRON_APP" ]; then
  mv "$ELECTRON_APP" "$RENAMED_APP"
fi
