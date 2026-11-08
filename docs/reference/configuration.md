# Configuration reference

Settings live in `config.json` in the data directory. Find it with:

```bash
longcord config path
```

Change settings with `longcord config set <key> <value>` instead of editing the file by hand. The
value is checked before it is saved. The server picks up most changes right away; the command tells
you when a restart is needed. Unknown keys are reported by `longcord doctor`.

Use `null` to clear a setting that can be empty, for example `longcord config set dailyRestart null`.

| Key                  | Default                  | What it does                                                                                                                                                            |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`               | `8417`                   | Local port the server listens on. Must be 1024–65535. Restart needed; run `longcord setup` again so `tailscale serve` points at the new port.                           |
| `host`               | `127.0.0.1`              | Loopback address to listen on: `127.0.0.1`, `::1` or `localhost`. Other values are rejected: longcord never listens on a network interface.                             |
| `publicUrl`          | `null`                   | The HTTPS address your phone uses, such as `https://my-pc.example-tailnet.ts.net`. Set by `longcord setup`. Used for pairing QR codes and the cross-site request check. |
| `projects`           | `[]`                     | Folders the agent may work in. Change with `longcord projects add` and `longcord projects remove`.                                                                      |
| `provider`           | `anthropic`              | Where model requests go: `anthropic` (API key), `bedrock`, `vertex` or `foundry`. See [environment variables](environment.md).                                          |
| `models`             | `[]`                     | Models offered in the app's model picker, for example `["claude-sonnet-4-5"]`. Empty hides the picker.                                                                  |
| `defaultModel`       | `null`                   | Model used when a session does not choose one. `null` uses the Agent SDK's default.                                                                                     |
| `defaultMode`        | `default`                | Permission mode preselected for imported sessions. See [permission modes](../guides/permission-modes.md).                                                               |
| `dailySpendCapUsd`   | `null`                   | Daily spend limit in US dollars, by your computer's local date. When reached, new runs are refused until midnight. See [spending](../guides/spending.md).               |
| `idleTimeoutMinutes` | `15`                     | Minutes an idle session keeps its agent process. After that the process is freed and resumed automatically on the next message.                                         |
| `maxToolOutputChars` | `4000`                   | How much of each tool's output is kept in the session log and shown in the app.                                                                                         |
| `logLevel`           | `info`                   | `debug`, `info`, `warn` or `error`. Restart needed.                                                                                                                     |
| `logContent`         | `false`                  | When `true` and `logLevel` is `debug`, prompts and file contents may appear in logs. Leave off unless you are debugging. Restart needed.                                |
| `logMaxBytes`        | `5242880`                | Size at which `longcord.log` is rotated. Restart needed.                                                                                                                |
| `logMaxFiles`        | `5`                      | How many rotated log files to keep. Restart needed.                                                                                                                     |
| `dailyRestart`       | `null`                   | Time (`HH:MM`, 24-hour, local time) at which the background service restarts the server once a day. Restart needed.                                                     |
| `keepAwake`          | `false`                  | macOS only: keep the Mac awake while longcord runs (using `caffeinate`). Restart needed.                                                                                |
| `pushSubject`        | the project's GitHub URL | Contact sent to push services with notifications (`mailto:` or `https://`). Apple requires a real-looking value; the default works.                                     |

## Files in the data directory

| Path                                      | Contents                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `config.json`                             | The settings above.                                                                            |
| `secrets.json`                            | API key, cookie signing secret, push (VAPID) keys and the passcode hash. Readable only by you. |
| `devices.json`                            | Paired devices (names and hashed tokens).                                                      |
| `pairing.json`                            | Hashed, short-lived pairing codes.                                                             |
| `push-subscriptions.json`                 | Push notification endpoints per device.                                                        |
| `spend.json`                              | Estimated spend per day.                                                                       |
| `schema.json`                             | Data format version, used for upgrades.                                                        |
| `sessions/<id>/meta.json`, `events.jsonl` | Each session's details and its append-only event log.                                          |
| `logs/`                                   | `longcord.log` and `supervisor.log`, rotated by size.                                          |
| `backups/`                                | Copies of the previous data made before each upgrade.                                          |

The data directory is `%APPDATA%\longcord` on Windows, `~/Library/Application Support/longcord` on
macOS and `$XDG_DATA_HOME/longcord` (usually `~/.local/share/longcord`) on Linux. Set
`LONGCORD_HOME` or pass `--home <dir>` to use another folder.
