// リリースビルドで余計なコンソールウィンドウを出さない(Windows 用、Mac では無害)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    keiri_note_lib::run()
}
