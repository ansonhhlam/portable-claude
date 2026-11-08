# Permission modes

The permission mode decides which actions the agent may take on its own and which ones
wait for you to tap **Allow** on your phone. You choose a mode when you start a session
and can change it at any time with the chips under the session title.

The agent always runs as your user account on the computer. Modes control when you are
asked, not what is technically possible, so pick the mode that matches how much you
trust the task and the content involved.

## The five modes

| Chip   | Mode                | Asks you before                                  | Good for                                          |
| ------ | ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Ask    | `default`           | Editing files and running commands               | Most work, and anything you have not reviewed     |
| Edits  | `acceptEdits`       | Running commands (edits in the project go ahead) | Coding tasks where you will review the diff later |
| Plan   | `plan`              | Nothing changes; the agent only reads and plans  | Exploring a codebase, reviewing an approach       |
| Auto   | `auto`              | Actions it judges risky                          | Routine tasks in projects you trust               |
| Bypass | `bypassPermissions` | Nothing. Never asks.                             | Disposable or sandboxed projects only             |

Reading and searching files generally happen without asking in every mode.

### Ask first (default)

The safest everyday choice. You see each edit as a diff and each command before it runs.
Answering from the phone is quick: **Allow**, **Deny** (optionally with a note telling the
agent what to do instead), or **Always allow**.

**Always allow** appears when the request can be turned into a rule, for example "allow
`npm test`". It lets matching requests through for the rest of the session. Use it for
harmless, repeated commands, not for broad patterns.

### Accept edits

File changes inside the project are applied without asking, but commands still need your
approval. Combine it with version control so you can review or undo changes afterwards
(`git diff`, `git checkout -- <file>`).

### Plan only

The agent can read and think but not change anything. It ends with a proposed plan. Switch
to another mode when you are happy with the plan and ask it to go ahead.

### Auto

Routine actions run on their own, and actions that look risky still come to you. This
judgment is made automatically and can be wrong, so treat Auto as convenient rather than
safe. Avoid it when the agent reads untrusted content such as third-party code, issues or
web pages.

### Bypass permissions

Nothing asks for approval. The agent can run any command and change or delete any file
your user account can reach, including outside the project.

Because of that:

- Choosing Bypass always shows a warning that you must confirm, and the session shows a red
  banner while it is active.
- A session that starts in Bypass runs the agent with the SDK's
  `allowDangerouslySkipPermissions` option. If you switch a running session to Bypass, the
  agent process restarts with that option when it is idle.
- Only use it in a throwaway environment, such as a disposable virtual machine or container
  with no access to your personal files or credentials.

## Changing the mode

- **On the phone:** tap a chip in the session header. The change applies to the next action.
- **Default for new sessions:** `longcord config set defaultMode default` (or `acceptEdits`,
  `plan`, `auto`). The new session screen also lets you pick per session.

## Tips

- Start unfamiliar work in **Plan only**, then switch to **Ask first**.
- When you deny, add a note. The agent sees it and usually changes course.
- If something looks wrong, tap **Stop**. It interrupts the current run and cancels pending
  approvals. Your next message continues the session.
- See [Security](../security.md) for prompt injection and the risk of each mode.
