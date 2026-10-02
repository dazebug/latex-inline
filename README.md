# LaTeX Inline

LaTeX Inline typesets the math in Claude's replies right inside your terminal. When Claude writes `$e^{i\pi} + 1 = 0$` in the middle of a sentence, you see the typeset formula in that sentence, at the size of the text around it, instead of the raw source. Display math (`$$...$$`) is drawn centered on its own lines. It is a Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview): it redraws each reply that contains math and leaves every other reply to Claude Code.

Formulas are laid out by [MathJax](https://www.mathjax.org/) with the Fira Math font and drawn through the kitty graphics protocol, so they need a terminal that shows pictures that way: [Ghostty](https://ghostty.org/), cmux (built on Ghostty) or [kitty](https://sw.kovidgoyal.net/kitty/).

## Requirements

- Claude Code 2.1.287 or later, in a terminal session
- Ghostty, cmux or kitty, not inside tmux, which does not pass the pictures through
- Node.js 18 or later with npm on your `PATH`: Claude Code uses npm to install the renderer's packages when it installs the plugin, and the plugin runs its renderer with `node`
- macOS or Linux

In any other terminal, and in the Desktop app, VS Code and `claude -p`, the plugin stays out of the way: replies are drawn as usual and Claude is not told to write LaTeX.

## Install

```bash
claude plugin marketplace add dazebug/latex-inline
claude plugin install latex-inline@latex-inline
```

Start a new session, or run `/reload-plugins` in an open one. `/plugin` then lists `latex-inline` among the active mods.

## Writing math

The plugin adds a short section to Claude's system prompt, only in sessions where it can draw, that asks Claude to write math this way. You can write the same way in your own messages, and set `teach_claude` to `false` if you would rather instruct Claude yourself.

- Inline math goes between single dollars: `$x^2$`. Put no space right after the opening `$` or right before the closing one, so `$20 and $30` stays text.
- Display math goes between double dollars in a paragraph of its own, with blank lines before and after.
- Math is drawn in paragraphs and list items. Math inside tables, headings, block quotes, code spans and code blocks is left as text.
- `\(...\)` and `\[...\]` work too. MathJax supports the AMS environments (`aligned`, `cases`, `pmatrix`, ...), and `\text{}` takes any script, including Hangul and kana.

If you turn `teach_claude` off, or want the rule in every session regardless of the terminal, add this to your `CLAUDE.md`:

```markdown
- Write math in LaTeX: inline as `$...$`, display as `$$...$$` in a paragraph of its own with blank lines around it. No space right after the opening `$` or right before the closing `$`. Do not use Unicode symbols such as α, ² or ≤ in place of LaTeX. Keep formulas out of tables, headings, block quotes and code; put dollar amounts and shell variables in code spans. Move long formulas and stacked fractions to display math.
```

## Configuration

Set options with `/plugin configure latex-inline@latex-inline` or in the `/config` panel.

| Option | Default | What it does |
| :- | :- | :- |
| `mode` | `auto` | `auto` draws only in Ghostty, cmux and kitty outside tmux. `on` draws in any terminal, `off` never. |
| `teach_claude` | `true` | Adds the math-writing section to the system prompt where the plugin draws. |
| `node_path` | `node` | The Node.js executable that runs the renderer. |
| `cell_aspect` | `2.2` | Your terminal font's cell height divided by its width. |
| `baseline` | `0.773` | Where the text baseline sits in a cell, as a fraction of the cell height from the top. |
| `line_height` | `1.32` | The cell height in ems of your terminal font. |
| `math_scale` | `1.62` | Inline formula size in ems of your terminal font. |
| `display_scale` | `2.18` | Display formula size in ems of your terminal font. |
| `color` | `auto` | Formula color: `auto` follows Claude Code's theme, or a `#rrggbb` color. |

The terminal stretches each picture to fill the cells it is given, so the three cell options must match your terminal font, or formulas look stretched and sit off the baseline. The defaults fit JetBrains Mono, Ghostty's default font. For other fonts:

| Terminal font | `cell_aspect` | `baseline` | `line_height` |
| :- | :- | :- | :- |
| JetBrains Mono (Ghostty default) | 2.2 | 0.773 | 1.32 |
| Fira Code | 2.0 | 0.75 | 1.231 |

For another font, read its metrics with a font tool: `line_height` is (ascender + descender + line gap) / units per em, `cell_aspect` is `line_height` divided by the advance width of `M` in ems, and `baseline` is the ascender divided by (ascender + descender + line gap).

Inline formulas never shrink to fit a text row. A formula that is taller than a row, such as one with a fraction or a subscript under a superscript, takes three rows, and that line of text is spaced apart to make room.

## What it runs, reads and writes

- **Runs**: `node bin/render.mjs` from the plugin folder, once per batch of new formulas, with the formulas on its standard input. It lays each formula out with MathJax and rasterizes it to PNG with [resvg](https://github.com/RazrFalcon/resvg). Nothing else is run.
- **Writes**: the PNG pictures and a small JSON record per formula in `$XDG_CACHE_HOME/latex-inline` (`~/.cache/latex-inline` by default). Delete that folder at any time to clear the cache.
- **Reads**: those cache files, your environment's `TERM`, `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `TMUX`, `HOME` and `XDG_CACHE_HOME`, Claude Code's `theme` setting, and, only for text inside `\text{}` that the math font has no glyph for, one CJK system font.
- **Network**: none at run time. Claude Code downloads the npm packages pinned in `package-lock.json` (`mathjax`, `@mathjax/mathjax-fira-font`, `@resvg/resvg-js`) when it installs the plugin.
- **Changes to Claude**: the math-writing section in the system prompt described above, only where the plugin draws.

## When a formula can't be drawn

- A formula MathJax can't parse, or one that uses an unknown command, shows its LaTeX source, dimmed, in its place. The rest of the reply is still drawn.
- If the renderer can't run at all (no `node`, missing packages), every formula shows its source dimmed, and the plugin tries again in the next session.
- While a new formula renders, its source shows for a moment and is then replaced.
- If a reply with math holds a single block of text or code longer than 10,000 characters, the plugin leaves that whole reply to Claude Code, which shows its LaTeX as text.

## Limitations

- Copying a reply out of the terminal copies the picture placeholders, not the LaTeX.
- Inline code, bold text and links in a paragraph that holds math are drawn by the plugin, close to but not exactly like Claude Code's own drawing.

## Troubleshooting

Start Claude Code with `claude --debug` and search the debug log for `latex-inline`. A line ending in `not loaded:` says why the mod did not load, and a `ui.render (AssistantMessage) refused` line names a drawing Claude Code rejected.

## License

MIT, see [LICENSE](LICENSE). The renderer's packages, installed from npm, keep their own licenses: MathJax and its fonts (Apache-2.0, with the Fira fonts under the SIL Open Font License) and resvg-js (MPL-2.0).
