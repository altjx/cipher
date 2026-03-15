#!/bin/bash
# Patches the local Electron.app bundle to show "Android Messages" in macOS
set -e

ELECTRON_APP="node_modules/electron/dist/Electron.app"
RENAMED_APP="node_modules/electron/dist/Android Messages.app"

# If already renamed, nothing to do
if [ -d "$RENAMED_APP" ]; then
  exit 0
fi

PLIST="$ELECTRON_APP/Contents/Info.plist"

# Patch Info.plist
/usr/libexec/PlistBuddy \
  -c 'Set :CFBundleName "Android Messages"' \
  -c 'Set :CFBundleDisplayName "Android Messages"' \
  "$PLIST" 2>/dev/null || true

# Rename the .app bundle itself
mv "$ELECTRON_APP" "$RENAMED_APP"
