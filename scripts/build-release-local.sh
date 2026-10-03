#!/bin/bash
# ローカルで配布用と同じ release ビルド(universal の .app)を作る。動作確認用で、配布はしない(配布は GitHub Actions のビルド)。
#
# Rust の実行ファイルには、エラーメッセージ用にソースのパスが埋め込まれる。そのままだと
# この Mac のユーザー名入りのパス(ホームフォルダ、~/.cargo の依存ソースなど)が残るため、
# ビルド時に --remap-path-prefix で置き換える。パスは $HOME などから組み立て、ユーザー名はどこにも書かない。
# 最後に、実行ファイルにユーザー名・ホームフォルダのパスが 0 件であることを確かめる(残っていたら失敗)。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
RUSTUP_HOME_DIR="${RUSTUP_HOME:-$HOME/.rustup}"

# 複数が当てはまるときは後に書いたものが使われるため、広い($HOME)→ 狭い(個別のフォルダ)の順に並べる
export RUSTFLAGS="--remap-path-prefix=$HOME=/home \
--remap-path-prefix=$RUSTUP_HOME_DIR=/rustup \
--remap-path-prefix=$CARGO_HOME_DIR=/cargo \
--remap-path-prefix=$CARGO_HOME_DIR/registry/src=/cargo-registry \
--remap-path-prefix=$CARGO_HOME_DIR/git/checkouts=/cargo-git \
--remap-path-prefix=$PROJECT_DIR=/project"

cd "$PROJECT_DIR/src-tauri"
cargo tauri build --target universal-apple-darwin --bundles app

APP="$(ls -d "$PROJECT_DIR"/src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app | head -1)"
BIN="$APP/Contents/MacOS/keiri-note"
USER_HITS=$(strings -a "$BIN" | grep -c -F "$(id -un)" || true)
HOME_HITS=$(strings -a "$BIN" | grep -c -F "$HOME" || true)
echo "ユーザー名を含む文字列: $USER_HITS 件 / ホームフォルダのパス: $HOME_HITS 件"
if [ "$USER_HITS" != "0" ] || [ "$HOME_HITS" != "0" ]; then
  echo "NG: 実行ファイルにユーザー名が残っています。このビルドは人に渡さないでください" >&2
  exit 1
fi
codesign --verify --deep --strict "$APP"
lipo -info "$BIN"
echo "OK: $APP"
