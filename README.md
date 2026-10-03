# LaTeX Inline

LaTeX Inline typesets the math in Claude's replies right inside your terminal. When Claude writes `$e^{i\pi} + 1 = 0$` in the middle of a sentence, you see the typeset formula in that sentence, at the size of the text around it, instead of the raw source. Display math (`$$...$$`) is drawn centered on its own lines. In terminals that can't show pictures, the same math is written as Unicode text instead: `e^(iπ) + 1 = 0`, `x = (−b ± √(b² − 4ac))/2a`. It is a Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview): it redraws each reply that contains math and leaves every other reply to Claude Code.

![A Claude Code session in Ghostty answering "Show me a few famous formulas": Euler's identity, the Gaussian integral, the Basel problem and the golden ratio inline in the text, the Fourier transform and Maxwell's equations as display math, Bayes' theorem, softmax and the Cauchy–Schwarz inequality in a list, Stirling's formula and a determinant inline, and four more formulas in a table, written as Unicode text](docs/screenshot.png)

*Ghostty with its default font (JetBrains Mono, 13pt) and the plugin's default settings.*

Formulas are laid out by [MathJax](https://www.mathjax.org/) with the Fira Math font and drawn through the kitty graphics protocol, so pictures need a terminal that shows them that way: [Ghostty](https://ghostty.org/), cmux (built on Ghostty) or [kitty](https://sw.kovidgoyal.net/kitty/). Everywhere else, including iTerm2, WezTerm, Terminal.app and anything inside tmux, you get the Unicode text.

## Requirements

- Claude Code 2.1.287 or later, in a terminal session
- For pictures: Ghostty, cmux or kitty, not inside tmux, which does not pass the pictures through; and Node.js 18 or later with npm on your `PATH`: Claude Code uses npm to install the renderer's packages when it installs the plugin, and the plugin runs its renderer with `node`
- macOS or Linux

The Unicode text needs nothing beyond Claude Code. In the Desktop app, VS Code and `claude -p`, the plugin stays out of the way: replies are drawn as usual.

## Install

```bash
claude plugin marketplace add dazebug/latex-inline
claude plugin install latex-inline@latex-inline
```

Start a new session, or run `/reload-plugins` in an open one. `/plugin` then lists `latex-inline` among the active mods, and `/latex-inline` shows whether it draws math in this terminal and which font it measured.

## Writing math

The plugin adds a short section to Claude's system prompt, only in sessions where it draws pictures, that asks Claude to write math this way. Where it writes Unicode text it asks nothing, so Claude writes math as it otherwise would, and the LaTeX it does write is converted. You can write the same way in your own messages, and set `teach_claude` to `false` if you would rather instruct Claude yourself.

- Inline math goes between single dollars: `$x^2$`. Put no space right after the opening `$` or right before the closing one, so `$20 and $30` stays text.
- Display math goes between double dollars in a paragraph of its own, with blank lines before and after.
- Math is drawn as pictures in paragraphs and list items. Math inside tables, headings and block quotes, where a picture can't go, is written as Unicode text. Math inside code spans and code blocks is left as written.
- `\(...\)` and `\[...\]` work too. MathJax supports the AMS environments (`aligned`, `cases`, `pmatrix`, ...), and `\text{}` takes any script, including Hangul and kana.

If you turn `teach_claude` off, or want Claude to write LaTeX in every session regardless of the terminal, add this to your `CLAUDE.md`:

```markdown
- Write math in LaTeX: inline as `$...$`, display as `$$...$$` in a paragraph of its own with blank lines around it. No space right after the opening `$` or right before the closing `$`. Do not use Unicode symbols such as α, ² or ≤ in place of LaTeX. Keep formulas out of tables, headings, block quotes and code; put dollar amounts and shell variables in code spans. Move long formulas and stacked fractions to display math.
```

## Configuration

Set options with `/plugin configure latex-inline@latex-inline` or in the `/config` panel. The values are yours alone: they are kept in your own settings, under `pluginConfigs`.

| Option | Default | What it does |
| :- | :- | :- |
| `mode` | `auto` | `auto` draws pictures in Ghostty, cmux and kitty outside tmux, and writes Unicode text in other terminals. `on` always draws pictures, `text` always writes Unicode text, `off` leaves the LaTeX as written. |
| `teach_claude` | `true` | Adds the math-writing section to the system prompt where the plugin draws pictures. |
| `node_path` | `node` | The Node.js executable that runs the renderer. |
| `font_metrics` | `auto` | `auto` measures your terminal font at session start (below). `manual` always uses the next three options. |
| `cell_aspect` | `2.125` | Your terminal cell's height divided by its width, in pixels. |
| `baseline` | `0.765` | Where the text baseline sits in a cell, as a fraction of the cell height from the top. |
| `line_height` | `1.308` | The cell height in ems of your terminal font. |
| `math_scale` | `1.62` | Inline formula size in ems of your terminal font. |
| `display_scale` | `2.18` | Display formula size in ems of your terminal font. |
| `color` | `auto` | Formula color: `auto` follows Claude Code's theme, or a `#rrggbb` color. |

Inline formulas never shrink to fit a text row. A formula that is taller than a row, such as one with a fraction or a subscript under a superscript, takes three rows, and that line of text is spaced apart to make room.

### Matching your terminal font

The terminal stretches each picture to fill the cells it is given, so the plugin has to know the shape of a cell: its height over its width, where the text baseline sits in it, and how tall it is in ems of the font. Get these wrong and formulas look stretched or sit above or below the text.

With `font_metrics` set to `auto`, the default, the plugin works them out at the start of each session:

1. It finds the font your terminal is set to. For Ghostty and cmux that is the first `font-family` in `~/.config/ghostty/config` (or `config.ghostty`, and on macOS `~/Library/Application Support/com.mitchellh.ghostty/config`), with Ghostty's built-in JetBrains Mono when none is set. For kitty it is `font_family` in `~/.config/kitty/kitty.conf`.
2. It finds that font's file in your font folders and reads its metrics: units per em, ascender, descender, line gap, and the widest advance among the printable ASCII characters.
3. It sizes a cell the way Ghostty does: at your `font-size` (13pt by default on macOS, 12pt elsewhere) times the display scale, the cell is the widest ASCII advance by the font's line height, each rounded to whole pixels, with the font's box centered in it. For kitty it uses the font's unrounded proportions.

Run `/latex-inline` to see the font it found and the numbers it uses. When it can't find the font, it falls back to the three options. Set `font_metrics` to `manual` and enter the numbers yourself when the measured cell is still off, which happens when:

- your Ghostty config changes the cell with `adjust-cell-height`, `adjust-cell-width` or `adjust-font-baseline`, or sets the font with `config-file` includes or command-line flags,
- you zoom the font in the terminal (cmd and plus or minus),
- your display scale differs from the plugin's assumption: 2x on macOS, 1x on Linux.

Measured values for common setups:

| Terminal font | `cell_aspect` | `baseline` | `line_height` |
| :- | :- | :- | :- |
| JetBrains Mono 13pt (Ghostty default), any display | 2.125 | 0.765 | 1.308 |
| Fira Code 12pt, Retina display | 2.0 | 0.767 | 1.25 |

To work the numbers out by hand for another font, take its units per em `u`, ascender `a`, descender `d` (negative), line gap `g` and widest ASCII advance `w` from a font tool, and your font size in points `s` times your display scale. With `p = s × scale / u`:

- cell width `W = round(w × p)` and cell height `H = round((a − d + g) × p)` pixels
- baseline from the bottom `B = round((g / 2 − d) × p − (H − (a − d + g) × p) / 2)` pixels
- `cell_aspect = H / W`, `baseline = (H − B) / H`, `line_height = H / (s × scale)`

## Unicode text

Where pictures can't be shown, each formula is converted to plain text that a terminal font can draw:

- Symbols become their characters: `\alpha` is α, `\le` is ≤, `\mathbb{R}` is ℝ, `\mathcal{L}` is ℒ, `\hat{y}` is ŷ.
- Superscripts and subscripts use Unicode's small letters where it has them all, as in x², θ⁽ᵗ⁺¹⁾ and ∑ᵢ₌₁ⁿ. Where it doesn't, they are written after `^` or `_`, as in e^(iπ) and 𝔼_(x∼p).
- Fractions and roots go on one line, with parentheses where needed: `\frac{1}{1+e^{-x}}` is 1/(1 + e⁻ˣ), `\sqrt{x+1}` is √(x + 1).
- Spacing follows TeX: binary operators and relations get a space on each side, a leading sign does not.
- A formula alone in its paragraph is centered.

The result is an approximation: tall structures such as matrices, `cases` and multi-line `aligned` blocks come out on one line, with rows separated by semicolons. A command it doesn't know is shown as written.

## Privacy

LaTeX Inline collects no data and sends nothing off your machine: it has no server and makes no network requests. Formulas are rendered by a local `node` process and kept as pictures in your cache folder. Everything it runs, reads and writes is listed below.

## What it runs, reads and writes

- **Runs**: where it draws pictures, `node bin/font-metrics.mjs` once at session start when `font_metrics` is `auto`, and `node bin/render.mjs` from the plugin folder once per batch of new formulas, with the formulas on its standard input. The renderer lays each formula out with MathJax and rasterizes it to PNG with [resvg](https://github.com/RazrFalcon/resvg). Nothing else is run.
- **Writes**: the PNG pictures and a small JSON record per formula in `$XDG_CACHE_HOME/latex-inline` (`~/.cache/latex-inline` by default). Delete that folder at any time to clear the cache.
- **Reads**: those cache files; your terminal's config file (`~/.config/ghostty/config` and its macOS and `.ghostty` variants, or `~/.config/kitty/kitty.conf`); the headers of the font files in your font folders, to find and measure the terminal font; your environment's `TERM`, `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `TMUX`, `HOME`, `XDG_CACHE_HOME` and `XDG_CONFIG_HOME`; Claude Code's `theme` setting; and, only for text inside `\text{}` that the math font has no glyph for, one CJK system font.
- **Network**: none at run time. Claude Code downloads the npm packages pinned in `package-lock.json` (`mathjax`, `@mathjax/mathjax-fira-font`, `@resvg/resvg-js`) when it installs the plugin.
- **Sends**: nothing leaves your machine. The formulas go to the local `node` renderer on its standard input, and the pictures come back as files in the cache folder.
- **Credentials**: none are read.
- **Hooks**: `session.start` works out how this terminal shows math, measures the font for pictures and registers `/latex-inline`; `command.run` answers `/latex-inline`; `prompt.compose` adds the math-writing section described above; `ui.render`, on assistant messages only, redraws a reply that holds math, or rewrites its math as Unicode text, and leaves the stored message as it was.
- **Changes to Claude**: the math-writing section in the system prompt described above, only where the plugin draws pictures, and the `/latex-inline` command. The Unicode text is computed in the plugin itself and runs nothing.

## When a formula can't be drawn

- A formula MathJax can't parse, or one that uses an unknown command, shows its LaTeX source, dimmed, in its place. The rest of the reply is still drawn.
- If the renderer can't run at all (no `node`, missing packages), every formula shows its source dimmed, and the plugin tries again in the next session.
- While a new formula renders, its source shows for a moment and is then replaced.
- If a reply with math holds a single block of text or code longer than 10,000 characters, the whole reply is written as Unicode text.

## Limitations

- Copying a reply out of the terminal copies the picture placeholders or the Unicode text, not the LaTeX.
- Claude's thinking, shown with ctrl+o, keeps its LaTeX as written: Claude Code gives mods no way to redraw it.
- Inline code, bold text and links in a paragraph that holds math are drawn by the plugin, close to but not exactly like Claude Code's own drawing.

## Troubleshooting

Run `/latex-inline` first: it says whether the plugin draws pictures or writes Unicode text in this terminal and, for pictures, which font it measured and the cell it uses. For more, start Claude Code with `claude --debug` and search the debug log for `latex-inline`. A line ending in `not loaded:` says why the mod did not load, and a `ui.render (AssistantMessage) refused` line names a drawing Claude Code rejected.

## Development

Load your clone for one session with `claude --plugin-dir ./latex-inline`; Claude Code doesn't install the packages for a plugin loaded in place, so run `npm ci --ignore-scripts` in the clone first. `claude plugin test` runs the parser, converter and hook tests, and `node --test tests/font-metrics.test.mjs` the font measuring tests.

## Acknowledgements

- The cache file names come from [cyrb53](https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js), bryc's public-domain string hash.
- The terminal cell is measured the way [Ghostty](https://github.com/ghostty-org/ghostty) (MIT) computes it in `src/font/Metrics.zig`.
- Formulas are laid out by [MathJax](https://www.mathjax.org/) in the [Fira Math](https://github.com/firamath/firamath) font and rasterized by [resvg](https://github.com/RazrFalcon/resvg).

## License

MIT, see [LICENSE](LICENSE). The renderer's packages, installed from npm, keep their own licenses: MathJax and its fonts (Apache-2.0, with the Fira fonts under the SIL Open Font License) and resvg-js (MPL-2.0).
