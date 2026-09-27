use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

const DATA_FILE: &str = "data.json";
const MAX_DATA_BYTES: usize = 200 * 1024 * 1024;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 一時ファイルに書く → fsync → rename → ディレクトリを fsync。
/// 途中で強制終了されても、元のファイルか新しいファイルのどちらかが完全な形で残る。
fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().expect("path has parent");
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name().unwrap().to_string_lossy()
    ));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    File::open(dir)?.sync_all()?;
    Ok(())
}

/// 保存データを返す。まだ無ければ None。
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(DATA_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_data(app: tauri::AppHandle, json: String) -> Result<(), String> {
    if json.len() > MAX_DATA_BYTES {
        return Err("データが大きすぎます".into());
    }
    // 壊れた JSON で上書きしない
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let path = data_dir(&app)?.join(DATA_FILE);
    atomic_write(&path, json.as_bytes()).map_err(|e| e.to_string())
}

/// 書き出し(CSV・バックアップ JSON)を「ダウンロード」フォルダに保存し、保存先のパスを返す。
/// 同名ファイルがあれば上書きせず連番を付ける。
#[tauri::command]
fn export_file(app: tauri::AppHandle, filename: String, content: String) -> Result<String, String> {
    // パス区切りや先頭のドットを除き、ファイル名だけを使う
    let name: String = filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
        .collect::<String>()
        .trim_start_matches('.')
        .to_string();
    if name.is_empty() || name.len() > 200 {
        return Err("ファイル名が不正です".into());
    }
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let (stem, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i..]),
        None => (name.as_str(), ""),
    };
    let mut path = dir.join(&name);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{} ({}){}", stem, n, ext));
        n += 1;
    }
    atomic_write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_data, save_data, export_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join(format!("keiri-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.json");
        atomic_write(&path, b"{\"a\":1}").unwrap();
        atomic_write(&path, b"{\"a\":2}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        assert!(!dir.join(".data.json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
