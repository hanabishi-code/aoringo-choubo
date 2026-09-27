// 取り込み検証(sanitizeBackup)をテスト用ファイルに対して実行する。実行: osascript -l JavaScript tests/check_import.js(リポジトリ直下で)
ObjC.import('Foundation');
function read(p){ return $.NSString.stringWithContentsOfFileEncodingError(p,4,null).js; }
var document={addEventListener:function(){}}; var window={}; var localStorage={getItem:function(){return null},setItem:function(){}};
var src=read('src/app.js');
var api=(new Function('document','window','localStorage', src+'\nreturn {sanitizeBackup:sanitizeBackup};'))(document,window,localStorage);
var files=['01_旧版_正常.json','02_不正レコード混在.json','03_壊れたJSON.json','04_別アプリ.json','05_新しい版.json','06_配列.json'];
var out=[];
files.forEach(function(f){
  try{
    var raw=JSON.parse(read('tests/fixtures/'+f)); var d=api.sanitizeBackup(raw);
    var n=function(a){return Array.isArray(a)?a.length:0}; var sum=(d.transactions||[]).reduce(function(t,x){return t+(Number(x.amount)||0)},0);
    var dropped=(n(raw.transactions)-n(d.transactions))+(n(raw.invoices)-n(d.invoices))+(n(raw.fixedAssets)-n(d.fixedAssets));
    var proto=(d.transactions||[]).some(function(t){return Object.prototype.hasOwnProperty.call(t,'__proto__')})||({}).polluted;
    out.push(f+': 取引'+n(d.transactions)+'件 合計'+sum+' 請求書'+n(d.invoices)+' 固定資産'+n(d.fixedAssets)+' 除外'+dropped+(d.settings?' 設定キー='+Object.keys(d.settings).join(','):'')+(proto?' ★proto残存':''));
  }catch(e){ out.push(f+': エラー → '+(e.userMessage||('JSON解析失敗 ('+e.name+')'))); }
});
out.join('\n');
