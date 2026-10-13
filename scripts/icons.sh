#!/bin/sh
# Redraws the app's icons from public/icon.svg. Needs rsvg-convert (librsvg) and ImageMagick.
set -eu
cd "$(dirname "$0")/.."
# Windows, Linux and the window itself: the tile fills the square.
rsvg-convert --width 1024 --height 1024 public/icon.svg --output public/icon.png
# macOS draws no shape of its own, and expects the tile at 824 of 1024 with room around it.
rsvg-convert --width 824 --height 824 public/icon.svg |
  magick - -background none -gravity center -extent 1024x1024 assets/icon-mac.png
