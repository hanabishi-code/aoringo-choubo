// 開発ビルドの自己テスト(KEIRI_SELFTEST=1 のときだけ Rust 側から実行される)。
// 画面の JS と同じ関数で、画像を作る → 圧縮 → save_receipt → read_receipt を通して確かめる。
(async function () {
  function report(msg) { return window.__TAURI__.core.invoke('selftest_report', { msg: msg }); }
  try {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b33f2e'; ctx.fillRect(0, 0, 64, 48);
    const png = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
    const blob = await compressImage(png);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const id = await saveReceiptBytes(bytes);
    const back = await readReceiptBytes(id);
    const same = back.length === bytes.length && back.every(function (b, i) { return b === bytes[i]; });
    const url = await receiptUrl(id);
    await report((same ? 'OK' : 'NG') + ' storage=' + STORAGE_MODE + (STORAGE_ERROR ? '(' + STORAGE_ERROR + ')' : '') + ' tx=' + state.transactions.length + ' id=' + id + ' saved=' + bytes.length + ' read=' + back.length + ' mime=' + imageMime(back) + ' url=' + url.slice(0, 5));
  } catch (e) {
    await report('NG ' + (e && e.stage ? e.stage + ' ' : '') + (typeof e === 'string' ? e : (e && e.message)));
  }
})();
