// 添付ファイル(schemaVersion 5)のテスト: 形式の判定、v4 → v5 の移行、取り込み時の検証、書き出す ID の集め方。
// 実行: osascript -l JavaScript tests/check_attach.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p) { return $.NSString.stringWithContentsOfFileEncodingError(p, 4, null).js; }
var document = { addEventListener: function () {} }; var window = {};
var localStorage = { getItem: function () { return null; }, setItem: function () {} };
function atob(s) { var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; s = String(s).replace(/=+$/, ''); var out = '', bits = 0, val = 0;
  for (var i = 0; i < s.length; i++) { var c = A.indexOf(s.charAt(i)); if (c < 0) throw new Error('InvalidCharacterError'); val = (val << 6) | c; bits += 6; if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 0xFF); } } return out; }
var app = (new Function('document', 'window', 'localStorage', 'atob', read('src/app.js') +
  '\nreturn { fileMime: fileMime, sanitizeBackup: sanitizeBackup, allAttachmentIds: allAttachmentIds, SCHEMA_VERSION: SCHEMA_VERSION };'))(document, window, localStorage, atob);

var results = [];
function check(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : '  実際=' + JSON.stringify(actual) + ' 期待=' + JSON.stringify(expected)));
}
function bytes(arr) { return new Uint8Array(arr); }
function str(s) { return bytes(s.split('').map(function (c) { return c.charCodeAt(0); })); }

check('形式の判定: JPEG / PNG / PDF / HEIC', [
  app.fileMime(bytes([0xFF, 0xD8, 0xFF, 0xE0])), app.fileMime(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
  app.fileMime(str('%PDF-1.7')), app.fileMime(bytes([0, 0, 0, 0x18].concat(str('ftypheic').length ? Array.prototype.slice.call(str('ftypheic')) : [])))
], ['image/jpeg', 'image/png', 'application/pdf', 'image/heic']);
check('形式の判定: SVG・拡張子だけの偽装・空は不可', [app.fileMime(str('<svg onload=x>')), app.fileMime(str('PDF-1.7')), app.fileMime(bytes([]))], [null, null, null]);

var v4 = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 4, transactions: [
  { id: 'tx_a', kind: 'expense', date: '2026-01-01', amount: 100, fund: 'cash', account: 'supplies', receiptAssetId: 'rc_1' },
  { id: 'tx_b', kind: 'expense', date: '2026-01-02', amount: 200, fund: 'cash', account: 'supplies', receiptAssetId: '' },
  { id: 'tx_c', kind: 'expense', date: '2026-01-03', amount: 300, fund: 'cash', account: 'supplies' }] });
check('移行 v4→v5: receiptAssetId → attachments(空・なしは添付なし)', v4.transactions.map(function (t) { return [t.attachments || null, t.receiptAssetId]; }),
  [[[{ id: 'rc_1' }], undefined], [null, undefined], [null, undefined]]);

var v5 = app.sanitizeBackup({ app: 'keiri-note', schemaVersion: 5,
  transactions: [{ id: 'tx_d', kind: 'expense', date: '2026-02-01', amount: 1, fund: 'cash', account: 'supplies', receiptAssetId: 'old', attachments: [
    { id: 'rc_ok', type: 'application/pdf', name: '請求書.pdf', addedAt: '2026-02-01T00:00:00Z' },
    { id: '../evil', type: 'image/jpeg' }, { id: 'rc_t', type: 'text/html' }, 'string', null, { id: 'rc_long', name: 'x'.repeat(500) }] }],
  invoices: [{ id: 'inv_1', number: '1', items: [], attachments: [{ id: 'rc_inv', type: 'application/pdf', name: '控え.pdf' }] }] });
var at = v5.transactions[0].attachments;
check('取り込み: 不正な ID・オブジェクトでないものは外す(取引は残す)', at.map(function (a) { return a.id; }), ['rc_ok', 'rc_t', 'rc_long']);
check('取り込み: 不明な形式名は外し、ファイル名は 200 文字まで', [at[1].type, at[2].name.length], [undefined, 200]);
check('取り込み: v5 に残った古い receiptAssetId は消す', v5.transactions[0].receiptAssetId, undefined);
check('請求書の添付(送った請求書の控え)も残る', v5.invoices[0].attachments, [{ id: 'rc_inv', type: 'application/pdf', name: '控え.pdf' }]);
check('書き出す添付 ID: 取引と請求書の両方から集める', app.allAttachmentIds(v5.transactions).concat(app.allAttachmentIds(v5.invoices)), ['rc_ok', 'rc_t', 'rc_long', 'rc_inv']);
check('SCHEMA_VERSION は 5', app.SCHEMA_VERSION, 5);

results.join('\n') + '\n\n' + results.filter(function (r) { return r.indexOf('NG') === 0; }).length + ' 件 NG / ' + results.length + ' 件';
