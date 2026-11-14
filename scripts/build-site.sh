#!/bin/sh
# Copy the files the site serves into _site/, which the Worker publishes as static assets.
set -e
cd "$(dirname "$0")/.."
rm -rf _site
mkdir _site
cp -r index.html privacy.html manifest.json service-worker.js css js icons _site/
