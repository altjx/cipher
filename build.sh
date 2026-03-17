#!/bin/bash
set -e

cd "$(dirname "$0")"

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

echo "==> Done! Cipher.app installed to /Applications/"
