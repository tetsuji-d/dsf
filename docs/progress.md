# Progress Log

このファイルは、エージェントを切り替えながら作業する際の共通ハンドオフログです。

## Rules
- 1セッション終了ごとに `Session Entry` を1件追加する。
- `Next Task` は必ず1つだけ書く。
- `Changed Files` は相対パスで列挙する。
- 未確定事項・判断待ちは `Risks / Notes` に明記する。
- ファイル衝突を防ぐため、必要なら `LOCK` / `UNLOCK` を使う。

---

## Session Entry Template

```md
### Session YYYY-MM-DD HH:MM (UTC)
- Agent:
- Branch:
- Goal:
- Start:
- End:
- Changed Files:
  - 
- Done:
  - 
- Next Task:
  - 
- Risks / Notes:
  - 
- LOCK:
  - 
- UNLOCK:
  - 
```

---

## Entries

### Session 2026-04-02 00:00 (UTC)
- Agent: bootstrap
- Branch: (fill)
- Goal: progress.md の初期作成
- Start: 2026-04-02 00:00
- End: 2026-04-02 00:00
- Changed Files:
  - docs/progress.md
- Done:
  - ハンドオフ用テンプレートを追加
  - 運用ルールを追加
- Next Task:
  - 次回セッションから実運用ログを追記する
- Risks / Notes:
  - 時刻は UTC で統一する
- LOCK:
  - (none)
- UNLOCK:
  - (none)
