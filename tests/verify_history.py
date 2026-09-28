# 強制終了テスト後の確認: data.json の取引(テスト用の初期データ以外)すべてに、完了した「取引の追加」履歴があるか。
# 使い方: python3 tests/verify_history.py <データフォルダ>(アプリを一度ふつうに起動して、保留の後始末が済んでから実行)
import json, os, sys
d = sys.argv[1]
data = json.load(open(os.path.join(d, 'data.json'), encoding='utf-8'))
entries, status, broken = [], {}, 0
lines = open(os.path.join(d, 'history.jsonl'), encoding='utf-8').read().split('\n')
for i, l in enumerate(lines):
    if not l.strip():
        continue
    try:
        e = json.loads(l)
    except Exception:
        broken += 1  # 強制終了で書きかけになった行(アプリは読み飛ばす)
        continue
    if 'ref' in e:
        status[e['ref']] = e['status']
    else:
        entries.append(e)
added_done = {e['after']['id'] for e in entries if e.get('action') == 'add' and e.get('target') == 'transaction' and status.get(e.get('hid')) == 'done'}
unresolved = [e for e in entries if e.get('status') == 'pending' and e.get('hid') not in status]
aborted = sum(1 for v in status.values() if v == 'aborted')
tx = [t['id'] for t in data['transactions'] if not t['id'].startswith('tx_stress')]
missing = [t for t in tx if t not in added_done]
ghost = [i for i in added_done if i not in set(t['id'] for t in data['transactions'])]
print(f"取引(テストで追加)={len(tx)} 完了した追加履歴={len(added_done)} 履歴なし={len(missing)} 取引がないのに完了={len(ghost)} 未解決の保留={len(unresolved)} 取り消し={aborted} 書きかけ行={broken}")
sys.exit(1 if (missing or ghost or unresolved) else 0)
