// 取り込み検証(sanitizeBackup)をテスト用ファイルに対して実行する。実行: osascript -l JavaScript tests/check_import.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p){ return $.NSString.stringWithContentsOfFileEncodingError(p,4,null).js; }
var document={addEventListener:function(){}}; var window={}; var localStorage={getItem:function(){return null},setItem:function(){}};
// JXA には atob が無いので最小限の実装を用意する(不正な文字は例外)
function atob(s){ var A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; s=String(s).replace(/=+$/,''); var out='',bits=0,val=0;
  for (var i=0;i<s.length;i++){ var c=A.indexOf(s.charAt(i)); if(c<0) throw new Error('InvalidCharacterError'); val=(val<<6)|c; bits+=6; if(bits>=8){ bits-=8; out+=String.fromCharCode((val>>bits)&0xFF); } } return out; }
var src=read('src/app.js');
var api=(new Function('document','window','localStorage','atob', src+'\nreturn {sanitizeBackup:sanitizeBackup};'))(document,window,localStorage,atob);
var files=['01_旧版_正常.json','02_不正レコード混在.json','03_壊れたJSON.json','04_別アプリ.json','05_新しい版.json','06_配列.json','07_レシート画像つき.json'];
var out=[];
files.forEach(function(f){
  try{
    var raw=JSON.parse(read('tests/fixtures/'+f)); var d=api.sanitizeBackup(raw);
    var n=function(a){return Array.isArray(a)?a.length:0}; var sum=(d.transactions||[]).reduce(function(t,x){return t+(Number(x.amount)||0)},0);
    var dropped=(n(raw.transactions)-n(d.transactions))+(n(raw.invoices)-n(d.invoices))+(n(raw.fixedAssets)-n(d.fixedAssets));
    var proto=(d.transactions||[]).some(function(t){return Object.prototype.hasOwnProperty.call(t,'__proto__')})||({}).polluted;
    out.push(f+': 取引'+n(d.transactions)+'件 合計'+sum+' 請求書'+n(d.invoices)+' 固定資産'+n(d.fixedAssets)+' 除外'+dropped+(d.settings?' 設定キー='+Object.keys(d.settings).join(','):'')+(proto?' ★proto残存':'')+' 添付'+Object.keys(d.receipts).length+'件(不正'+d.droppedReceipts+') 添付参照='+(d.transactions||[]).map(function(t){return (t.attachments||[]).map(function(a){return a.id}).join('+')}).filter(Boolean).join('/'));
  }catch(e){ out.push(f+': エラー → '+(e.userMessage||('JSON解析失敗 ('+e.name+')'))); }
});
out.join('\n');
