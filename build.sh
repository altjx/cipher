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

echo "==> Done! Android Messages.app installed to /Applications/"
