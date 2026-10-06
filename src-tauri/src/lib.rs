use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

const DATA_FILE: &str = "data.json";
const BACKUP_DIR: &str = "backups";
const KEEP_DAYS: i64 = 30;
const PRE_RESTORE_SUFFIX: &str = "-pre-restore";
const PRE_IMPORT_SUFFIX: &str = "-pre-import";
const PRE_WIPE_SUFFIX: &str = "-pre-wipe";
const PRE_MIGRATE_SUFFIX: &str = "-pre-migrate";
/// 削除前の退避に変更履歴を同梱するときのキー(sanitizeBackup は未知のキーを無視する)
const BUNDLED_HISTORY_KEY: &str = "_historyJsonl";
const HISTORY_FILE: &str = "history.jsonl";
const RECEIPTS_DIR: &str = "receipts";
// 添付ファイル(レシート・領収書・請求書の画像や PDF)。原本のまま保存するため上限は大きめ
const MAX_RECEIPT_BYTES: usize = 20 * 1024 * 1024;
const VIEW_DIR_NAME: &str = "青りんご帳簿-view";
const MAX_HISTORY_ENTRY_BYTES: usize = 1024 * 1024;
const MAX_DATA_BYTES: usize = 200 * 1024 * 1024;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 開発ビルドのみ: KEIRI_DATA_DIR で保存先を差し替えられる(自己テストで本物のデータに触れないため)
    #[cfg(debug_assertions)]
    if let Ok(d) = std::env::var("KEIRI_DATA_DIR") {
        let dir = PathBuf::from(d);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
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

/// 書き出し(CSV・バックアップ JSON)。Mac 標準の保存ダイアログを Rust 側で出し、
/// ユーザーが選んだ場所にだけ書く。保存したファイル名を返し、キャンセルなら None(何も書かない)。
/// 画面側は保存先を指定できない(ダイアログの初期ファイル名だけを渡す)。
/// ダイアログの応答待ちでメインスレッドを止めないよう async コマンドにしている。
#[tauri::command]
async fn export_file(app: tauri::AppHandle, filename: String, content: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // パス区切りや先頭のドットを除き、ファイル名だけを初期値に使う
    let name: String = filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0'))
        .collect::<String>()
        .trim_start_matches('.')
        .to_string();
    if name.is_empty() || name.len() > 200 {
        return Err("ファイル名が不正です".into());
    }
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(ext) = name.rsplit_once('.').map(|(_, e)| e.to_string()) {
        let label = if ext.eq_ignore_ascii_case("csv") { "CSV" } else { "JSON" };
        dialog = dialog.add_filter(label, &[ext.as_str()]);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    // 既存ファイルへの上書きは、保存ダイアログでユーザーが確認済み
    atomic_write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/* ---------- 自動バックアップ ---------- */

/// "data-YYYY-MM-DD_HHMMSS.json"(退避は "...HHMMSS-pre-restore.json" / "-pre-import.json" / "-pre-wipe.json" / "-pre-migrate.json")から日付を取り出す。
/// 形式が違うファイルは None(一覧にも出さず、削除対象にもしない)
fn backup_date(name: &str) -> Option<chrono::NaiveDate> {
    let rest = name.strip_prefix("data-")?.strip_suffix(".json")?;
    let rest = rest
        .strip_suffix(PRE_RESTORE_SUFFIX)
        .or_else(|| rest.strip_suffix(PRE_IMPORT_SUFFIX))
        .or_else(|| rest.strip_suffix(PRE_WIPE_SUFFIX))
        .or_else(|| rest.strip_suffix(PRE_MIGRATE_SUFFIX))
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
    backup_with_suffix(&app, PRE_RESTORE_SUFFIX)?;
    restore_into(&data_dir(&app)?, &src)
}

/// バックアップの内容を data.json に書き戻す。削除前の退避に同梱された変更履歴があれば履歴も戻す。
fn restore_into(dir: &Path, src: &[u8]) -> Result<(), String> {
    let mut v: serde_json::Value = serde_json::from_slice(src).map_err(|e| e.to_string())?;
    let bundled = v
        .as_object_mut()
        .and_then(|o| o.remove(BUNDLED_HISTORY_KEY))
        .and_then(|h| h.as_str().map(|s| s.to_string()));
    let data = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
    if let Some(old) = bundled {
        // 削除後に記録された履歴は消さず、その前に削除前の履歴を戻す(同じものを二重に戻さない)
        let hpath = dir.join(HISTORY_FILE);
        let cur = fs::read_to_string(&hpath).unwrap_or_default();
        if !old.is_empty() && !cur.starts_with(&old) {
            let mut merged = old.clone();
            if !merged.ends_with('\n') {
                merged.push('\n');
            }
            merged.push_str(&cur);
            atomic_write(&hpath, merged.as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    atomic_write(&dir.join(DATA_FILE), &data).map_err(|e| e.to_string())
}

/// すべてのデータを削除する前に、変更履歴も含めて「削除前の退避」を必ず作り、変更履歴を消す。
/// data.json 自体は、この後に画面側が空の状態を保存して置き換える。
#[tauri::command]
fn wipe_all(app: tauri::AppHandle) -> Result<(), String> {
    wipe_in_dir(&data_dir(&app)?, chrono::Local::now().naive_local())
}

fn wipe_in_dir(dir: &Path, now: chrono::NaiveDateTime) -> Result<(), String> {
    let mut v: serde_json::Value = match fs::read(dir.join(DATA_FILE)) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e.to_string()),
    };
    let hpath = dir.join(HISTORY_FILE);
    let history = match fs::read_to_string(&hpath) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    v.as_object_mut()
        .ok_or("データの形式が不正です")?
        .insert(BUNDLED_HISTORY_KEY.into(), serde_json::Value::String(history));
    let bdir = dir.join(BACKUP_DIR);
    fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let name = format!("data-{}{}.json", now.format("%Y-%m-%d_%H%M%S"), PRE_WIPE_SUFFIX);
    let bytes = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
    atomic_write(&bdir.join(name), &bytes).map_err(|e| e.to_string())?;
    match fs::remove_file(&hpath) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    File::open(dir).and_then(|d| d.sync_all()).map_err(|e| e.to_string())
}

/// データ形式(schemaVersion)を新しくする前に、現在の data.json を「移行前」として必ず退避する
#[tauri::command]
fn backup_before_migration(app: tauri::AppHandle) -> Result<(), String> {
    backup_with_suffix(&app, PRE_MIGRATE_SUFFIX)
}

/// JSON 取り込みの前に、現在のデータを「取り込み前」として退避する
#[tauri::command]
fn backup_before_import(app: tauri::AppHandle) -> Result<(), String> {
    backup_with_suffix(&app, PRE_IMPORT_SUFFIX)
}

/* ---------- 変更履歴(追記専用) ---------- */

/// 1件を1行の JSON として追記する。日時はこちらで付ける。書き換え・削除のコマンドは用意しない。
fn append_history_line(path: &Path, entry: &str, at: &str) -> Result<(), String> {
    use std::fs::OpenOptions;
    if entry.len() > MAX_HISTORY_ENTRY_BYTES {
        return Err("履歴が大きすぎます".into());
    }
    let mut v: serde_json::Value = serde_json::from_str(entry).map_err(|e| e.to_string())?;
    let obj = v.as_object_mut().ok_or("履歴の形式が不正です")?;
    obj.insert("at".into(), serde_json::Value::String(at.to_string()));
    let mut line = serde_json::to_string(&v).map_err(|e| e.to_string())?;
    line.push('\n');
    let mut f = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    // 前回の書き込みが途中で終わっていたら(末尾に改行がない)、改行を補ってから追記する
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len > 0 {
        use std::io::{Read, Seek, SeekFrom};
        let mut last = [0u8; 1];
        f.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        f.read_exact(&mut last).map_err(|e| e.to_string())?;
        if last[0] != b'\n' {
            line.insert(0, '\n');
        }
    }
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    f.sync_data().map_err(|e| e.to_string())
}

#[tauri::command]
fn append_history(app: tauri::AppHandle, entry: String) -> Result<(), String> {
    let at = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    append_history_line(&data_dir(&app)?.join(HISTORY_FILE), &entry, &at)
}

/// 新しい順に最大 limit 件。強制終了で途中まで書かれた行などは読み飛ばす。
fn read_history_lines(path: &Path, limit: usize) -> Result<Vec<String>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    Ok(text
        .lines()
        .rev()
        .filter(|l| serde_json::from_str::<serde_json::Value>(l).is_ok())
        .take(limit)
        .map(|l| l.to_string())
        .collect())
}

#[tauri::command]
fn read_history(app: tauri::AppHandle, limit: usize) -> Result<Vec<String>, String> {
    read_history_lines(&data_dir(&app)?.join(HISTORY_FILE), limit.min(5000))
}

/* ---------- レシート画像 ---------- */

/// 画像 ID は英数字・_・- のみ(パスとして解釈される文字を含めない)
fn valid_receipt_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 先頭のバイト列(ファイルの中身)で形式を判定し、拡張子を返す。JPEG / PNG / HEIC / PDF のみ
fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(b"%PDF-") {
        Some("pdf")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"heic" | b"heix" | b"heim" | b"heis" | b"mif1" | b"msf1")
    {
        Some("heic")
    } else {
        None
    }
}
const ATTACHMENT_EXTS: [&str; 4] = ["jpg", "png", "heic", "pdf"];

/// 新しい画像 ID を作る(時刻 + 連番。英数字と _ のみ)
fn new_receipt_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("rc_{}_{}", nanos, SEQ.fetch_add(1, Ordering::Relaxed))
}

/// receipts/<新しいID>.jpg|png に保存し、ID を返す。画像は一度保存したら変えない
fn save_receipt_in(dir: &Path, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_RECEIPT_BYTES {
        return Err("画像が大きすぎます".into());
    }
    let ext = image_ext(bytes).ok_or("JPEG / PNG / HEIC / PDF 以外のファイルは添付できません")?;
    let rdir = dir.join(RECEIPTS_DIR);
    fs::create_dir_all(&rdir).map_err(|e| e.to_string())?;
    let mut id = new_receipt_id();
    while find_receipt(&rdir, &id).is_some() {
        id = new_receipt_id();
    }
    atomic_write(&rdir.join(format!("{}.{}", id, ext)), bytes).map_err(|e| e.to_string())?;
    Ok(id)
}

fn find_receipt(rdir: &Path, id: &str) -> Option<PathBuf> {
    ATTACHMENT_EXTS
        .iter()
        .map(|ext| rdir.join(format!("{}.{}", id, ext)))
        .find(|p| p.exists())
}

/// 画像のバイト列を受け取って保存し、Rust 側で作った画像 ID を返す(ヘッダーは使わない)
#[tauri::command]
fn save_receipt(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    // 通常は画像のバイト列がそのまま届く。IPC が postMessage 方式に切り替わっていると数値の配列(JSON)で届く
    let json_bytes;
    let bytes: &[u8] = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b,
        tauri::ipc::InvokeBody::Json(v) => {
            json_bytes = serde_json::from_value::<Vec<u8>>(v.clone())
                .map_err(|_| "画像データの形式が不正です(JSON)".to_string())?;
            &json_bytes
        }
    };
    #[cfg(debug_assertions)]
    eprintln!(
        "[debug] save_receipt body={} len={} headers={:?}",
        if matches!(request.body(), tauri::ipc::InvokeBody::Raw(_)) { "Raw" } else { "Json" },
        bytes.len(),
        request.headers().keys().map(|k| k.as_str()).collect::<Vec<_>>()
    );
    save_receipt_in(&data_dir(&app)?, bytes)
}

/// 開発ビルドの自己テスト用: 結果を標準出力に出して終了する。リリースビルドでは何もしない
#[tauri::command]
fn selftest_report(app: tauri::AppHandle, msg: String) {
    if cfg!(debug_assertions) && std::env::var("KEIRI_SELFTEST").is_ok() {
        println!("[selftest] {}", msg);
        app.exit(0);
    }
}

#[tauri::command]
fn read_receipt(app: tauri::AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    if !valid_receipt_id(&id) {
        return Err("画像 ID が不正です".into());
    }
    let path = find_receipt(&data_dir(&app)?.join(RECEIPTS_DIR), &id).ok_or("画像が見つかりません")?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 添付ファイルを「プレビュー」で開く。原本は開かず、一時フォルダに読み取り専用のコピーを作って開く
/// (プレビューで編集・保存しても原本は変わらない)。一時フォルダは起動時と終了時に消す
#[tauri::command]
fn open_attachment(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_receipt_id(&id) {
        return Err("添付ファイルの ID が不正です".into());
    }
    let src = find_receipt(&data_dir(&app)?.join(RECEIPTS_DIR), &id).ok_or("添付ファイルが見つかりません")?;
    let vdir = std::env::temp_dir().join(VIEW_DIR_NAME);
    fs::create_dir_all(&vdir).map_err(|e| e.to_string())?;
    let dst = vdir.join(src.file_name().ok_or("ファイル名が不正です")?);
    if dst.exists() {
        // 前回のコピーは読み取り専用なので、書き込めるようにしてから置き換える
        let mut perm = fs::metadata(&dst).map_err(|e| e.to_string())?.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        let _ = fs::set_permissions(&dst, perm);
        let _ = fs::remove_file(&dst);
    }
    fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    let mut perm = fs::metadata(&dst).map_err(|e| e.to_string())?.permissions();
    perm.set_readonly(true);
    fs::set_permissions(&dst, perm).map_err(|e| e.to_string())?;
    std::process::Command::new("/usr/bin/open")
        .arg("-a")
        .arg("Preview")
        .arg(&dst)
        .status()
        .map_err(|e| e.to_string())
        .and_then(|st| if st.success() { Ok(()) } else { Err("プレビューで開けませんでした".into()) })
}

/// 印刷(請求書など)。macOS の WKWebView では画面の window.print() で印刷ダイアログが開かないため、
/// Tauri の Webview::print(WebKit の印刷)を使う。印刷用の領域と @media print の CSS がそのまま使われる。
/// 印刷ダイアログの「PDF」から PDF として保存もできる
#[tauri::command]
fn print_page(webview: tauri::Webview) -> Result<(), String> {
    webview.print().map_err(|e| e.to_string())
}

/// 画面の色(設定の「画面の色」)。ウィンドウの枠(タイトルバー)も同じ色にする。
/// "light" / "dark" 以外は Mac の外観に合わせる
#[tauri::command]
fn set_theme(window: tauri::Window, theme: String) -> Result<(), String> {
    let t = match theme.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    window.set_theme(t).map_err(|e| e.to_string())
}

/// 表示用の一時コピーを消す(読み取り専用のファイルも消せる)
fn clean_view_dir() {
    let vdir = std::env::temp_dir().join(VIEW_DIR_NAME);
    if let Ok(rd) = fs::read_dir(&vdir) {
        for e in rd.flatten() {
            if let Ok(meta) = e.metadata() {
                let mut perm = meta.permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                perm.set_readonly(false);
                let _ = fs::set_permissions(e.path(), perm);
            }
        }
    }
    let _ = fs::remove_dir_all(&vdir);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_theme,
            load_data,
            save_data,
            export_file,
            list_backups,
            read_backup,
            restore_backup,
            backup_before_import,
            backup_before_migration,
            append_history,
            wipe_all,
            save_receipt,
            read_receipt,
            open_attachment,
            print_page,
            selftest_report,
            read_history
        ])
        .on_page_load(|webview, payload| {
            // 開発ビルドのみ: KEIRI_SELFTEST があれば、画面の JS からレシート保存・読み出しを実際に試す
            if cfg!(debug_assertions)
                && std::env::var("KEIRI_SELFTEST").is_ok()
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let script = if std::env::var("KEIRI_SELFTEST").as_deref() == Ok("stress") {
                    include_str!("selftest_stress.js")
                } else {
                    include_str!("selftest.js")
                };
                let _ = webview.eval(script);
            }
        })
        .setup(|app| {
            // 開発ビルドの自己テスト中は、ウィンドウも Dock アイコンも出さない
            if cfg!(debug_assertions) && std::env::var("KEIRI_SELFTEST").is_ok() {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            clean_view_dir();
            if let Err(e) = auto_backup(app.handle()) {
                eprintln!("起動時のバックアップに失敗: {}", e);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                clean_view_dir();
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
        backup_in_dir(&dir, PRE_MIGRATE_SUFFIX, t("2026-09-28 07:30:00")).unwrap(); // 移行前も同じ内容でも作る
        let names = list_backup_names(&dir.join(BACKUP_DIR));
        assert_eq!(
            names,
            vec![
                "data-2026-09-28_064655.json",
                "data-2026-09-28_072000-pre-restore.json",
                "data-2026-09-28_073000-pre-migrate.json"
            ]
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn history_appends_and_skips_broken_lines() {
        let dir = std::env::temp_dir().join(format!("keiri-test-hist-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(HISTORY_FILE);
        append_history_line(&path, r#"{"action":"add","n":1}"#, "2026-09-28T08:00:00+09:00").unwrap();
        // 強制終了で途中まで書かれた行を再現
        fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"{\"action\":\"upd").unwrap();
        append_history_line(&path, r#"{"action":"delete","n":2}"#, "2026-09-28T08:01:00+09:00").unwrap();
        assert!(append_history_line(&path, "not json", "x").is_err());
        assert!(append_history_line(&path, "[1]", "x").is_err());
        let lines = read_history_lines(&path, 10).unwrap();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"n\":2") && lines[0].contains("08:01:00"));
        assert!(lines[1].contains("\"n\":1"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn wipe_bundles_history_and_restore_brings_it_back() {
        let dir = std::env::temp_dir().join(format!("keiri-test-wipe-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let t = |s: &str| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap();
        fs::write(dir.join(DATA_FILE), br#"{"transactions":[{"id":"tx_1"}]}"#).unwrap();
        append_history_line(&dir.join(HISTORY_FILE), r#"{"action":"add"}"#, "A").unwrap();
        wipe_in_dir(&dir, t("2026-09-28 09:00:00")).unwrap();
        assert!(!dir.join(HISTORY_FILE).exists());
        let names = list_backup_names(&dir.join(BACKUP_DIR));
        assert_eq!(names, vec!["data-2026-09-28_090000-pre-wipe.json"]);
        // 削除後に新しい記録が1件
        fs::write(dir.join(DATA_FILE), br#"{"transactions":[]}"#).unwrap();
        append_history_line(&dir.join(HISTORY_FILE), r#"{"action":"new"}"#, "B").unwrap();
        let src = fs::read(dir.join(BACKUP_DIR).join(&names[0])).unwrap();
        restore_into(&dir, &src).unwrap();
        restore_into(&dir, &src).unwrap(); // 2回戻しても削除前の履歴は二重にならない
        let data = fs::read_to_string(dir.join(DATA_FILE)).unwrap();
        assert!(data.contains("tx_1") && !data.contains(BUNDLED_HISTORY_KEY));
        let hist = read_history_lines(&dir.join(HISTORY_FILE), 10).unwrap();
        assert_eq!(hist.len(), 2, "{:?}", hist);
        assert!(hist[0].contains("new") && hist[1].contains("add"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn receipts_validate_and_get_new_ids() {
        let dir = std::env::temp_dir().join(format!("keiri-test-rc-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, 1];
        let id1 = save_receipt_in(&dir, &jpg).unwrap();
        let id2 = save_receipt_in(&dir, &jpg).unwrap();
        assert_ne!(id1, id2);
        assert!(valid_receipt_id(&id1));
        assert_eq!(fs::read(dir.join(format!("receipts/{}.jpg", id1))).unwrap(), jpg);
        assert!(save_receipt_in(&dir, b"<svg>").is_err());
        // PDF・HEIC は中身で判定して原本のまま保存する
        let pdf = b"%PDF-1.7\n%test";
        let pid = save_receipt_in(&dir, pdf).unwrap();
        assert_eq!(fs::read(dir.join(format!("receipts/{}.pdf", pid))).unwrap(), pdf);
        let heic = [0, 0, 0, 0x18, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c', 1, 2];
        let hid = save_receipt_in(&dir, &heic).unwrap();
        assert!(dir.join(format!("receipts/{}.heic", hid)).exists());
        assert!(save_receipt_in(&dir, b"PDF-1.7 not really").is_err());
        assert!(save_receipt_in(&dir, &vec![0xFF; MAX_RECEIPT_BYTES + 1]).is_err());
        assert!(!valid_receipt_id("../evil"));
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
