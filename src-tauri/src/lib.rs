use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

const DATA_FILE: &str = "data.json";
const BACKUP_DIR: &str = "backups";
const KEEP_DAYS: i64 = 30;
const PRE_RESTORE_SUFFIX: &str = "-pre-restore";
const PRE_IMPORT_SUFFIX: &str = "-pre-import";
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

/* ---------- 自動バックアップ ---------- */

/// "data-YYYY-MM-DD_HHMMSS.json"(退避は "...HHMMSS-pre-restore.json" / "-pre-import.json")から日付を取り出す。
/// 形式が違うファイルは None(一覧にも出さず、削除対象にもしない)
fn backup_date(name: &str) -> Option<chrono::NaiveDate> {
    let rest = name.strip_prefix("data-")?.strip_suffix(".json")?;
    let rest = rest
        .strip_suffix(PRE_RESTORE_SUFFIX)
        .or_else(|| rest.strip_suffix(PRE_IMPORT_SUFFIX))
        .unwrap_or(rest);
    let (date, time) = rest.split_once('_')?;
    if time.len() != 6 || !time.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

/// 保持ルール: 直近30日分はすべて残す。それより古いものは各月の最後の1つ(月末分)だけ残す。
/// 削除すべきファイル名を返す。
fn backups_to_delete(names: &[String], today: chrono::NaiveDate) -> Vec<String> {
    use chrono::Datelike;
    use std::collections::HashMap;
    let cutoff = today - chrono::Duration::days(KEEP_DAYS - 1);
    let mut newest_in_month: HashMap<(i32, u32), &String> = HashMap::new();
    for n in names {
        if let Some(d) = backup_date(n) {
            let e = newest_in_month.entry((d.year(), d.month())).or_insert(n);
            if n > *e {
                *e = n; // 名前は日時順に並ぶので文字列比較で新しい方がわかる
            }
        }
    }
    names
        .iter()
        .filter(|n| match backup_date(n) {
            Some(d) => d < cutoff && newest_in_month.get(&(d.year(), d.month())) != Some(n),
            None => false,
        })
        .cloned()
        .collect()
}

fn list_backup_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| backup_date(n).is_some())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// data.json を backups/ に日時付きで複製し、古いものを整理する。
/// data.json が無い、または直近のバックアップと同じ内容なら複製しない。
fn auto_backup(app: &tauri::AppHandle) -> Result<(), String> {
    backup_with_suffix(app, "")
}

/// suffix が空(通常の自動バックアップ)なら、直近と同じ内容のときは作らない。
/// 復元前・取り込み前の退避(suffix あり)は、内容が同じでも必ず作る。
fn backup_with_suffix(app: &tauri::AppHandle, suffix: &str) -> Result<(), String> {
    backup_in_dir(&data_dir(app)?, suffix, chrono::Local::now().naive_local())
}

fn backup_in_dir(dir: &Path, suffix: &str, now: chrono::NaiveDateTime) -> Result<(), String> {
    let data = match fs::read(dir.join(DATA_FILE)) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let bdir = dir.join(BACKUP_DIR);
    fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let names = list_backup_names(&bdir);
    let skip = suffix.is_empty()
        && names
            .last()
            .and_then(|n| fs::read(bdir.join(n)).ok())
            .map_or(false, |b| b == data);
    if !skip {
        let name = format!("data-{}{}.json", now.format("%Y-%m-%d_%H%M%S"), suffix);
        atomic_write(&bdir.join(name), &data).map_err(|e| e.to_string())?;
    }
    let names = list_backup_names(&bdir);
    for n in backups_to_delete(&names, now.date()) {
        let _ = fs::remove_file(bdir.join(n));
    }
    Ok(())
}

/// バックアップ一覧(新しい順)
#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut names = list_backup_names(&data_dir(&app)?.join(BACKUP_DIR));
    names.reverse();
    Ok(names)
}

/// 一覧にある名前だけを受け付ける(パスを含む名前などは拒否)
fn backup_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if backup_date(name).is_none() || name.contains('/') || name.contains('\\') {
        return Err("バックアップ名が不正です".into());
    }
    Ok(data_dir(app)?.join(BACKUP_DIR).join(name))
}

#[tauri::command]
fn read_backup(app: tauri::AppHandle, name: String) -> Result<String, String> {
    fs::read_to_string(backup_path(&app, &name)?).map_err(|e| e.to_string())
}

/// 現在のデータを「復元前」として退避してから、選んだバックアップで data.json を置き換える
#[tauri::command]
fn restore_backup(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let src = fs::read(backup_path(&app, &name)?).map_err(|e| e.to_string())?;
    serde_json::from_slice::<serde_json::Value>(&src).map_err(|e| e.to_string())?;
    backup_with_suffix(&app, PRE_RESTORE_SUFFIX)?;
    atomic_write(&data_dir(&app)?.join(DATA_FILE), &src).map_err(|e| e.to_string())
}

/// JSON 取り込みの前に、現在のデータを「取り込み前」として退避する
#[tauri::command]
fn backup_before_import(app: tauri::AppHandle) -> Result<(), String> {
    backup_with_suffix(&app, PRE_IMPORT_SUFFIX)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            export_file,
            list_backups,
            read_backup,
            restore_backup,
            backup_before_import
        ])
        .setup(|app| {
            if let Err(e) = auto_backup(app.handle()) {
                eprintln!("起動時のバックアップに失敗: {}", e);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Err(e) = auto_backup(app) {
                    eprintln!("終了時のバックアップに失敗: {}", e);
                }
            }
        });
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

    #[test]
    fn pre_restore_backup_is_made_even_if_unchanged() {
        let dir = std::env::temp_dir().join(format!("keiri-test-bk-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(DATA_FILE), b"{\"a\":1}").unwrap();
        let t = |s: &str| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap();
        backup_in_dir(&dir, "", t("2026-09-28 06:46:55")).unwrap();
        backup_in_dir(&dir, "", t("2026-09-28 07:00:00")).unwrap(); // 同じ内容 → 作らない
        backup_in_dir(&dir, PRE_RESTORE_SUFFIX, t("2026-09-28 07:20:00")).unwrap(); // 同じ内容でも作る
        let names = list_backup_names(&dir.join(BACKUP_DIR));
        assert_eq!(
            names,
            vec![
                "data-2026-09-28_064655.json",
                "data-2026-09-28_072000-pre-restore.json"
            ]
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn retention_keeps_recent_and_month_ends() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 9, 28).unwrap();
        let names: Vec<String> = [
            "data-2026-07-03_100000.json", // 7月: 古い → 削除
            "data-2026-07-31_180000.json", // 7月の最後 → 残す
            "data-2026-08-20_090000.json", // 8月: 古い → 削除
            "data-2026-08-29_120000.json", // 30日より前で、8月の最後ではない(08-30 がある) → 削除
            "data-2026-08-30_080000.json", // 直近30日の初日 → 残す
            "data-2026-09-28_070000.json", // 今日 → 残す
            "data-2026-07-10_100000-pre-restore.json", // 復元前の退避も同じルール → 削除
            "data-2026-07-11_100000-pre-import.json",  // 取り込み前の退避も同じルール → 削除
            "../data-2026-07-01_000000.json",          // 形式違い → 触らない
            "memo.txt",                    // 形式違い → 触らない
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let mut del = backups_to_delete(&names, today);
        del.sort();
        assert_eq!(
            del,
            vec![
                "data-2026-07-03_100000.json",
                "data-2026-07-10_100000-pre-restore.json",
                "data-2026-07-11_100000-pre-import.json",
                "data-2026-08-20_090000.json",
                "data-2026-08-29_120000.json"
            ]
        );
    }
}
