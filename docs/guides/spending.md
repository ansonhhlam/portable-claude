# Spending and the daily cap

## How you are billed

longcord uses the model provider you configured during setup:

- **Anthropic API key:** usage is billed by Anthropic to the account that owns the key, per
  token, at API prices. This is **separate from any Claude subscription** (Pro, Max, Team
  or Enterprise). A subscription does not cover API usage, and longcord cannot use a
  claude.ai login.
- **Amazon Bedrock, Google Vertex AI or Microsoft Foundry:** usage is billed by that cloud
  provider on your cloud account.

longcord itself is free and sends nothing to anyone except your chosen model provider.

## What longcord shows

- Each finished run shows a line like `Done · $0.0123 · 12.3s · 3 turns`.
- The session header shows the session's total cost, time and turns.
- The home screen shows today's spend, and the cap if you set one.
- **Settings > Spend** shows the same numbers.

These figures come from the cost the Claude Agent SDK reports for each run. They are
**estimates** based on list prices. Your provider's bill is the source of truth: discounts,
taxes, cloud pricing differences and caching can make it differ. "Today" means the
computer's local calendar day.

## Set a daily cap

A cap stops new work once the day's estimated spend reaches the limit:

```sh
longcord config set dailySpendCapUsd 10
```

You can also pass `--daily-cap 10` to `longcord setup`. To remove the cap:

```sh
longcord config set dailySpendCapUsd null
```

When the cap is reached:

- Sending a message or starting a session fails with a message saying the cap was reached.
- If notifications are on, you get one notification that day.
- The home screen shows "daily cap reached".
- The cap resets at local midnight on the computer.

The cap is checked before a message is sent to the agent. A run that is already in progress
is allowed to finish, so the day's total can end up slightly above the cap. Pick a cap with
some headroom.

## Also set a limit with your provider

The daily cap is a convenience, not a billing guarantee. Set a hard limit where you are
billed too:

- **Anthropic:** set spend limits for your organization or workspace in the Anthropic
  Console, and consider a dedicated workspace and API key for longcord.
- **Cloud providers:** set budgets and alerts in your cloud account.

## Keeping costs down

- Start in **Plan only** to agree on an approach before the agent does a lot of work.
- Give specific prompts with file names and a clear finish line.
- Start a new session for a new task instead of continuing a very long one. Long
  conversations cost more per message because more context is sent each time.
- If you configured several models (the `models` config key, a JSON list), pick a smaller
  model for simple tasks on the new session screen.
- Tap **Stop** as soon as a run goes in the wrong direction.
