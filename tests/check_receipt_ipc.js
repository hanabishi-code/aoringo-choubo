// レシート画像の保存・読み出しが invoke ラッパーを通って正しく届くかを確かめる(モック)。
// 実機の WKWebView を通す確認は: KEIRI_SELFTEST=1 KEIRI_DATA_DIR=<一時フォルダ> で開発ビルドを起動(src-tauri/src/selftest.js)
// 実行: osascript -l JavaScript tests/check_receipt_ipc.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p){ return $.NSString.stringWithContentsOfFileEncodingError(p,4,null).js; }
var store = {}; var calls = []; var lastId = null;
var window = { __TAURI__: { core: { invoke: function (cmd, args, options) {
  calls.push(cmd);
  if (cmd === 'save_receipt') {
    if (!(args instanceof Uint8Array)) return Promise.reject('画像データの形式が不正です');
    var id = 'rc_test_' + Object.keys(store).length; // Rust 側と同じく、ID は保存側で作って返す
    store[id] = args.slice(); lastId = id;
    return Promise.resolve(id);
  }
  if (cmd === 'read_receipt') {
    if (!store[args.id]) return Promise.reject('画像が見つかりません');
    return Promise.resolve(store[args.id].buffer);
  }
  return Promise.reject('unknown ' + cmd);
} } } };
var document = { addEventListener: function () {} };
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
var api = (new Function('window', 'document', 'localStorage', read('src/app.js') + '\nreturn { saveReceiptBytes: saveReceiptBytes, readReceiptBytes: readReceiptBytes };'))(window, document, localStorage);
var jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
api.saveReceiptBytes(jpg);
var saved = lastId && store[lastId];
var out = [];
out.push(saved ? 'OK: save_receipt に画像のバイト列がそのまま届いた' : 'NG: save_receipt に画像が届いていない');
out.push(saved && saved.length === jpg.length && saved.every(function (b, i) { return b === jpg[i]; }) ? 'OK: 届いたバイト列が一致' : 'NG: バイト列が違う');
calls.length = 0;
api.readReceiptBytes(lastId);
out.push(calls[0] === 'read_receipt' ? 'OK: read_receipt が呼ばれた' : 'NG: read_receipt が呼ばれていない');
out.join('\n');
