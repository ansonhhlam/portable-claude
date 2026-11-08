# Environment variables

| Variable                 | Used by        | Meaning                                                                                                            |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `LONGCORD_HOME`          | CLI and server | Use this folder as the data directory instead of the per-OS default. `--home <dir>` does the same for one command. |
| `ANTHROPIC_API_KEY`      | server, doctor | Anthropic API key. Overrides the key stored by `longcord setup`. Keys are never written to logs.                   |
| `LONGCORD_MOCK_DELAY_MS` | `start --mock` | Delay between streamed words of the mock agent, in milliseconds (default 40). `0` makes the mock instant.          |

## Model providers

longcord authenticates only with an Anthropic API key or with one of the cloud providers the Claude
Agent SDK supports. It never uses a claude.ai login: any claude.ai login token in the environment is
removed before the agent starts.

API usage is billed by Anthropic (or your cloud provider) separately from any Claude subscription.

Choose the provider with `longcord setup --provider <name>` or `longcord config set provider <name>`.

| Provider    | What longcord sets          | What you set up                                                                                    |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `anthropic` | `ANTHROPIC_API_KEY`         | An API key from the Anthropic Console, stored with `longcord setup`.                               |
| `bedrock`   | `CLAUDE_CODE_USE_BEDROCK=1` | AWS credentials the AWS SDK can find (for example a profile in `~/.aws`) and `AWS_REGION`.         |
| `vertex`    | `CLAUDE_CODE_USE_VERTEX=1`  | Google Cloud application default credentials, `CLOUD_ML_REGION` and `ANTHROPIC_VERTEX_PROJECT_ID`. |
| `foundry`   | `CLAUDE_CODE_USE_FOUNDRY=1` | Microsoft Foundry credentials and resource settings as described in the Agent SDK documentation.   |

The background service does not inherit your shell's environment. To give it provider variables,
add them to `providerEnv` in `secrets.json` (a JSON object of names to values), for example:

```json
{ "providerEnv": { "AWS_REGION": "us-east-1", "AWS_PROFILE": "work" } }
```

Restart longcord after changing them.
