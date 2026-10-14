# schoolsoft-agent

[![Unit](https://github.com/grimen/schoolsoft-agent/raw/gh-pages/badges/main/unit.svg)](https://github.com/grimen/schoolsoft-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![E2E](https://github.com/grimen/schoolsoft-agent/raw/gh-pages/badges/main/e2e.svg)](https://github.com/grimen/schoolsoft-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![Coverage](https://github.com/grimen/schoolsoft-agent/raw/gh-pages/badges/main/coverage.svg)](https://github.com/grimen/schoolsoft-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![npm](https://img.shields.io/npm/v/schoolsoft-agent)](https://www.npmjs.com/package/schoolsoft-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

<img src="docs/assets/readme-hero.svg" alt="Independent project; SchoolSoft and BankID are trademarks of their owners, who are not involved. A parent asks their AI agent about school. The agent reaches schoolsoft-agent through its MCP server or its CLI skill; both share one core that logs in with BankID in the parent's own browser and reads schedule, lunch, assignments, news and messages from SchoolSoft. SchoolSoft is a trademark of SchoolSoft AB, not involved in this project." width="960">

[SchoolSoft](https://www.schoolsoft.se) for AI agents. Lets an agent (Claude, OpenCode, OpenClaw, Hermes, Pi, …) read a guardian's SchoolSoft data: schedule, full calendar, lunch menu, assignments, news and the message inbox. Login is [BankID](https://www.bankid.com) in your own browser; nothing is automated around it, and the session is stored encrypted on the computer or server you operate.

Choose the connection your assistant supports:

| Surface                                             | What it is                                                                          | Best for                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **MCP server** `schoolsoft-agent-mcp`               | A stdio MCP server exposing one tool per operation                                  | Claude Code, Claude Desktop, OpenCode, OpenClaw, Hermes, any MCP host        |
| **Parent-hosted connector** `schoolsoft-agent-http` | Remote MCP over HTTPS, limited to children, schedule, calendar and lunch            | Claude/ChatGPT custom connectors; release candidate, live acceptance pending |
| **CLI + skill** `schoolsoft-agent`                  | A JSON-emitting CLI wrapped by an [Agent Skills](https://agentskills.io) `SKILL.md` | Hosts without MCP (Pi), shell-first agents, scripting                        |

The local MCP server and CLI expose the same operation registry. The remote connector exposes a restricted selection with separate login and child permissions. All share the same core. See [docs/development/architecture.md](docs/development/architecture.md).

> **Independent project.** [SchoolSoft](https://www.schoolsoft.se) is a trademark of SchoolSoft AB. This is an independent, MIT-licensed community project: it is not affiliated with, endorsed by, or supported by SchoolSoft AB, and SchoolSoft has no involvement in it. It talks to SchoolSoft through the same unofficial APIs the SchoolSoft app uses; read [Trademark and independence](#trademark-and-independence) and [Privacy](#privacy) before installing.

## Start here

**[Browse all documentation](docs/README.md).**

**New to AI assistants? Start with the [parent setup guide](docs/getting-started/README.md).** It helps you choose one app, install SchoolSoft, complete BankID and check your first answer.

- **Mac or Windows, graphical setup:** [Claude Desktop in five steps](docs/integrations/claude/desktop.md).
- **Already chose an assistant:** [find its guide](docs/getting-started/README.md#1-choose-your-starting-point), including ChatGPT/Codex, OpenClaw, Hermes, Pi and OpenCode.
- **Want Claude/ChatGPT without a local agent:** [parent-hosted connector setup](docs/deployment/connector.md). The implementation and deployment recipes are a release candidate; real SchoolSoft login and AI client/mobile acceptance are still pending. Do not buy hosting expecting a proven phone setup yet.

The [detailed support matrix](docs/integrations/support-matrix.md) compares desktop, web, mobile and remote-computer setups, including effort and current limitations. You do not need to read it to follow the recommended desktop guide.

## Try it in a terminal first (optional)

Prerequisite: [Node.js](https://nodejs.org/en/download) 22 or newer.

```bash
npx -y schoolsoft-agent                                    # a guided first run, in Swedish or English
```

It asks for your school's name, opens BankID in your own browser, checks that SchoolSoft answers, shows this week's schedule and says where your data is kept and how to add an AI assistant. Stop with Ctrl+C at any time; `npx -y schoolsoft-agent setup` continues where you left off. The same steps one by one, for scripts (`setup --query "<name>"` does them without asking):

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"   # finds your school
npx -y schoolsoft-agent login                              # BankID in your browser
npx -y schoolsoft-agent get-calendar --pretty              # lessons and school events this week (JSON)
npx -y schoolsoft-agent get-schedule --format text         # this week's schedule, laid out for people
```

Output is JSON for assistants and scripts; `--format text` shows children, schedule, calendar, lunch and messages as [views for people](docs/getting-started/terminal.md).

Every command is in the [command reference](docs/reference/commands.md); every crucial one is also a `make` target in a checkout (`make help`). Messages come in Swedish when your system language is Swedish (or with `SCHOOLSOFT_LANG=sv`), always as "what went wrong" plus "Next: what to do".

## What you can ask

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "What is happening at school next week, including lessons and school events?"
- "Har vi fått några meddelanden från skolan?"
- "Vilka läxor finns den här veckan?"

The agent picks the child (`list_children`), the week, and the right operation. Contact lists, bookings and shared files have no data feed at SchoolSoft; those are read through an optional hidden browser (`npx -y schoolsoft-agent browser install`, once). Grades, student documents, absence reports and assessment criteria additionally sit behind SchoolSoft's "log in again" gate and need `npx -y schoolsoft-agent login --web` once, a normal web login in a browser window. Both extras are explained step by step in [Get started](docs/getting-started/README.md#4-optional-extras-only-if-you-want-them). Full list of what an agent can ask for: [MCP tools](docs/reference/tools.md) · [CLI commands](docs/reference/commands.md).

The parent-hosted connector currently supports **children, schedule, calendar and lunch only**. Messages, assignments and the extra browser features above belong to the local MCP/CLI routes.

## How login works

For the local MCP server and CLI:

1. The agent calls `login`. Your browser opens SchoolSoft's real login page for guardians.
2. You authenticate with BankID (or whatever your municipality offers). Enter your login details only on the official login page, never in the assistant.
3. SchoolSoft redirects to `http://127.0.0.1:43117/callback` with a one-time code; the integration exchanges it for tokens and session cookies.
4. Tokens are stored encrypted (AES-256-GCM, key file `0600`) and refreshed silently. You log in again only when the refresh token expires.

For the **parent-hosted connector**, start login on your server's owner page. The browser returns to that server's HTTPS callback; its acceptance by SchoolSoft needs a real test. The session stays on your server, and each AI app gets separately revocable permission for selected children. Follow the [connector guide](docs/deployment/connector.md).

Login problems are covered in [Troubleshooting](docs/getting-started/troubleshooting.md). Details and diagrams: [docs/development/architecture.md](docs/development/architecture.md). What SchoolSoft actually exposes: [docs/reference/schoolsoft-api.md](docs/reference/schoolsoft-api.md).

## Persistent read-only access

A background assistant can read a guardian's school data on a schedule without a new BankID approval each time, until the refresh token dies. This is unofficial access to SchoolSoft's own app API. SchoolSoft AB and the BankID operator are not involved, and their terms may not allow unattended use. Read those terms before relying on this.

The stdio MCP server does not expose school writes (no absence reports, no sending messages, no bookings). `report-absence` remains a CLI command and stays off unless `SCHOOLSOFT_ALLOW_WRITES=1`. Login and logout only change the session stored on this computer.

### Setup

Prerequisite: Node.js 22 or newer. Use a placeholder slug such as `example` in docs and tests; your real tenant slug is the first path segment of the school portal URL (`https://sms.schoolsoft.se/<slug>/`). Several schools in one municipality usually share that slug. The school inside the tenant is chosen by child, not by a second slug. One guardian with children at two tenants is two slugs and two saved sessions in the same state directory.

```bash
npx -y schoolsoft-agent configure --query "your school name"
npx -y schoolsoft-agent login
npx -y schoolsoft-agent get-schedule --weeks 3
npx -y schoolsoft-agent get-messages
```

`configure` looks up the tenant slug. `login` opens the real login page in your browser and prints the URL. You approve BankID yourself. Nothing in this project approves BankID for you. Tokens are stored encrypted (AES-256-GCM, key file mode `0600`) and are not printed. A failed refresh says `SESSION_EXPIRED` and `SchoolSoft session expired, needs a new BankID login by the guardian`, and it does not try the refresh token again.

For a municipality whose login is SAML (Täby uses a host like `etjanst.taby.se`), the browser follows that hop and returns to the school portal, then to `http://127.0.0.1:43117/callback`. Portal cookies on the school host and its parent domain are kept. Cookies from the identity-provider host are not. That redirect chain was not re-run against a live login for this change.

Access tokens last about 15 minutes. A later command or the MCP server refreshes them with the rotating refresh token, saves the new refresh token before it is used, and takes a file lock so two runs (a CLI command and the MCP server, or two schools) do not spend the same token. Pass `--weeks 3` on `get-schedule` for the current week and the next two. Each lesson has `status`: `scheduled`, `cancelled` or `changed`.

Other reads, as JSON from the CLI or as MCP tools: assignments (date and submission status), calendar events, messages (subject, sender, date, body, unread — the inbox list does not load the body; opening one message is a GET and this client never sends a separate "mark as read"), news (title, date, body, attachment names when the portal sends them), unreported absence and the attendance report (web login, see below), grades.

### Still missing or risky

- **Refresh-token lifetime is unknown.** When it dies, the only fix is a new BankID login by the guardian. Do not script retries around `SESSION_EXPIRED`.
- **BankID and SchoolSoft terms.** Unattended, token-based access may violate them even though the login itself is done by the person in their own browser.
- **Täby SAML was not live-tested here.** Redirects, the Shibboleth cookie, and the return to the localhost callback are handled as far as the offline code can show. A real login is still required before trusting a Täby tenant.
- **Cancelled and changed lessons.** The timetable is read from the recorded lessons endpoint. The flag is taken from field names seen in community clients (`cancelled`, `changed`, `status`, and similar). Those names were not re-checked against a live response. A missing flag is reported as `scheduled`.
- **Assignments, news attachments, and the full message body** use the field names recorded for the app. News as recorded has a boolean "has attachment", not file names; names are included only when the JSON actually contains them. Whether opening one message marks it read on the server was not re-checked. The inbox list is the safe unread check.
- **Attendance, lateness, and unreported absence** are the web pages behind SchoolSoft's "log in again" gate (`login --web`, once, BankID in the browser again). Lateness is whatever text that attendance table shows. There is no separate verified lateness field, and choosing another week would be a form post, which this client does not send. The unreported-absence page was only seen empty.
- **Plannings** have a known path (`/rest-api/parent/ps/planning_parts/start-page`) whose JSON shape was never recorded, so it is not called. **Grades** are `get_grades` (and the grade-prognosis call), also behind the web login, and often empty until the school publishes them.
- **Lunch** is already available and is not part of this read-only daily set.

## Privacy

**[How your family's data is handled](docs/getting-started/data-handling.md)** explains, in plain language, what is stored, where, for how long, and what reaches your AI provider, SchoolSoft and your hosting provider. In short:

- Requested school information is sent to your chosen assistant/model provider, which handles it under its own terms. A messaging interface may involve another provider. This project has no telemetry, crash reporting or analytics, and no author-operated service receiving family data.
- Local installations save an encrypted session under your platform's config directory (`schoolsoft-agent doctor` shows where). `schoolsoft-agent logout` deletes that session. The parent-hosted connector also saves encrypted permissions and owner identity on your server; follow its [deletion steps](docs/deployment/connector.md#everyday-use-and-recovery).
- With parent hosting, your hosting provider and anyone administering your server may access data while it is processed. Encryption at rest does not prevent that access. The project author does not host your copy or receive its SchoolSoft session.
- Nothing is written to log files. The few diagnostic lines on stderr contain no children's names or school content.
- This is unofficial automated access. Check SchoolSoft's terms of service for your municipality before relying on it.
- Reporting an absence is the only tool that changes anything at SchoolSoft. It is off unless you set `SCHOOLSOFT_ALLOW_WRITES=1` and previews before sending. Every other tool only reads, and the hidden browser blocks any request that could change something.

## Development

```bash
git clone https://github.com/grimen/schoolsoft-agent && cd schoolsoft-agent
make setup          # node check + npm ci + git hooks
make check          # lint, typecheck, format, boundaries, manifests, tests with coverage
make e2e-artifact   # shipped-artifact + host E2E in a sandbox (what CI runs)
make e2e            # live suite against SchoolSoft (needs configure + one login)
make help           # everything else
```

Layout, boundaries, design principles and the test pyramid are in [docs/development/architecture.md](docs/development/architecture.md); conventions, hooks and the CI stages in [CONTRIBUTING.md](CONTRIBUTING.md); how versions ship in [docs/development/releasing.md](docs/development/releasing.md); the rules every coding agent follows in [AGENTS.md](AGENTS.md). What we know about SchoolSoft's unofficial APIs and web pages, page by page, is in [docs/reference/schoolsoft-api.md](docs/reference/schoolsoft-api.md). Adding an operation touches one file under `src/core/operations/` plus the registry; both surfaces and the docs follow.

## Roadmap

- Write operations: report absence, send message (separate spec; confirmation-gated).
- Parent-hosted connector acceptance: the HTTP implementation and deployment recipes are present. Complete real SchoolSoft public-callback login, both AI clients, mobile availability and recovery checks before calling it supported. [Setup and remaining checks](docs/deployment/connector.md).
- Claude Desktop extension directory listing.
- Other school portals: everything vendor-specific sits behind one `SchoolProvider` seam (`src/providers/`), so a second Swedish portal is a new provider directory, not a rewrite. All of them end their login in BankID, which the core already handles two ways.

## Trademark and independence

SchoolSoft is a trademark of SchoolSoft AB. This is an independent, MIT-licensed community project: it is not affiliated with, endorsed by, or supported by SchoolSoft AB, and SchoolSoft has no involvement in it. The name is used only to describe what the software connects to. [BankID](https://www.bankid.com) is a trademark of Finansiell ID-Teknik BID AB; Claude, ChatGPT, OpenCode, OpenClaw, Hermes and Pi are trademarks of their respective owners. All are named descriptively, and none of these organisations is involved in or endorses this project. No logos or brand assets are used. If any rights holder objects to a use of their name, open an issue and it will be addressed.

## License

MIT © Jonas Grimfelt. No SchoolSoft client library is bundled: the HTTP code is this project's own. Thanks to the community clients whose published observations helped map the unofficial API, among them [elias4044/ssp-node](https://github.com/elias4044/ssp-node) (MIT), a runtime dependency until E6.3, and [sebdanielsson/better-schoolsoft](https://github.com/sebdanielsson/better-schoolsoft). The API knowledge and its sources are documented in [docs/reference/schoolsoft-api.md](docs/reference/schoolsoft-api.md).
