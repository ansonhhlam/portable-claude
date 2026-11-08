# Resuming sessions

There are two kinds of "resuming" in longcord: continuing a longcord session after a pause,
and importing a session that was started on the computer with another tool.

## Continuing a longcord session

Just open the session and send a message. You do not need to do anything special, even
after days.

Behind the scenes, longcord stops a session's agent process after 15 minutes without
activity (`idleTimeoutMinutes`) to free memory, unless an approval is waiting. The
conversation is kept, and your next message starts a fresh process that picks up the same
conversation. The first reply after a pause can take a few seconds longer.

The same applies after the computer or the longcord service restarts. Runs that were in
progress at the time are stopped; send a message to continue.

To change the idle timeout:

```sh
longcord config set idleTimeoutMinutes 30
```

## Importing a session started on the computer

Sessions started on the computer with tools built on the Claude Agent SDK, such as
Anthropic's terminal coding tool, are stored by the SDK on that computer per project
folder. longcord can import one so you can continue it from your phone.

1. Make sure the folder is a longcord project (`longcord projects list`; add it with
   `longcord projects add <path>`). The import list only shows sessions whose folder matches
   the project.
2. On the phone, tap **New session**, choose the project, then tap
   **Resume a session from this computer**.
3. Pick a session from the list. Each entry shows a summary, when it was last changed and
   the git branch, if any.
4. Tap **Import**.

The session opens with its earlier messages shown dimmed and labelled **Imported**. They
are read-only history. Send a message to continue the conversation; the agent has the full
earlier context.

### Things to know

- **Do not continue the same session in two places at once.** If you keep using it in the
  terminal after importing, the two copies will diverge. Pick one place to continue.
- Imported history shows messages and which tools were used, but not every detail of
  earlier tool output.
- Costs from before the import are not included in longcord's totals.
- The imported session uses the permission mode you choose in longcord, not the settings
  from the terminal tool.
