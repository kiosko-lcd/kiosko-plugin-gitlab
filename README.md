# kiosko-plugin-gitlab

Your merge requests' pipelines and the reviews waiting for you.

A plugin for [Kiosko](https://github.com/kiosko-lcd/kiosko), the widget mosaic for small USB LCD panels.

![My pipelines](docs/pipelines.png)

## Install

In Kiosko, **Plugins → Install from npm** → `kiosko-plugin-gitlab`, then restart Kiosko. Or from a terminal:

```sh
npm install --prefix ~/.config/kiosko/plugins kiosko-plugin-gitlab
```

(macOS: `~/Library/Application Support/Kiosko/plugins`, Windows: `%APPDATA%\Kiosko\plugins`.)

## Requirements

- [`glab`](https://gitlab.com/gitlab-org/cli) logged in, or a personal access token with `read_api` in the source options.

## Widgets

### My pipelines — `gitlab/pipelines`

The pipeline of each of your open merge requests: broken first, then running and queued, passing last.

![My pipelines](docs/pipelines.png)

Uses: `gitlab/merge-requests`.

| Option | Type | Default | |
|---|---|---|---|
| `rows` | number | `0` | Rows. 0 = as many as fit. A number shows that many, in rows of a readable size (fewer when the tile is too small for them); the rest are counted in "+N more". |
| `layout` | `auto` \| `one-line` \| `detailed` | `"auto"` | Row layout. Automatic: the widget picks by the tile's shape. |
| `projects` | list | `[]` | Projects. Empty: all. Names or patterns, comma-separated: * matches anything, a leading ! leaves out (web, acme/*, !*-old). |
| `hidePassing` | boolean | `false` | Hide passing pipelines. Only what is broken, running or waiting. |
| `includeDrafts` | boolean | `false` | Include drafts |
| `aliases` | map | `{}` | Short project names. Project (as in its path) → what to show, e.g. web-frontend → web. |

### Reviews for me — `gitlab/reviews`

Merge requests waiting for your review: whose, how long they have waited and how their pipeline is doing. The ones you approved sink, dimmed.

![Reviews for me](docs/reviews.png)

Uses: `gitlab/merge-requests`.

| Option | Type | Default | |
|---|---|---|---|
| `rows` | number | `0` | Rows. 0 = as many as fit. A number shows that many, in rows of a readable size (fewer when the tile is too small for them); the rest are counted in "+N more". |
| `layout` | `auto` \| `one-line` \| `detailed` | `"auto"` | Row layout. Automatic: the widget picks by the tile's shape. |
| `projects` | list | `[]` | Projects. Empty: all. Names or patterns, comma-separated: * matches anything, a leading ! leaves out (web, acme/*, !*-old). |
| `includeDrafts` | boolean | `false` | Include drafts |
| `hideApproved` | boolean | `false` | Hide the ones I approved |
| `includeAssigned` | boolean | `false` | Include the ones assigned to me. For teams that assign a merge request to its reviewer instead of requesting a review. Your own are left out. |
| `aliases` | map | `{}` | Short project names. Project (as in its path) → what to show, e.g. web-frontend → web. |

## Data sources

### GitLab merge requests — `gitlab/merge-requests`

Your open merge requests, the ones you are asked to review and the ones assigned to you, through glab or a token. Read every 3 min while a widget uses it. Options are set once in Kiosko → Settings → Data sources.

| Option | Type | Default | |
|---|---|---|---|
| `host` | string | `""` | GitLab host. Empty = glab's default host (gitlab.com with a token). |
| `token` | string | *(secret)* | Access token. A personal access token with read_api. Empty = use the glab CLI and its login. |
| `bin` | string | `"glab"` | glab command |

## Development

```sh
npm install
npm test          # node:test
npm run check     # TypeScript
npm run build     # dist/index.js, what Kiosko loads
```

To try it in a running Kiosko without publishing: `kiosko plugins link .` and restart Kiosko.

Working on Kiosko and its plugins together: clone them side by side
(`kiosko/` and `kiosko-plugins/kiosko-plugin-gitlab/`) and run `npm install` in
`kiosko/`; its workspaces link every plugin found in `../kiosko-plugins`.

## License

MIT
