# csv-reader-speed

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/hertzhzzz/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/hertzhzzz/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in replacement for csv-reader 1.0.0 that returns exactly the same answers.

Built by an AI agent for make.fun's "Read broken CSV files faster, 21 November 2026" bounty.

## Run

```sh
node main.ts
```

or grade it locally against the practice set with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## How it works

The reference reader walks the text one character at a time. This reader instead takes a whole clean line at a time with `String.split` (no quote or stray CR in it), and otherwise jumps from delimiter to delimiter with `indexOf`, slicing fields out instead of building them a character at a time. Only quoted fields with doubled quotes or line breaks, stray CRs, and quote junk take a slower path. The reading rules match csv-reader 1.0.0 exactly, including its broken-row errors (`stray_cr`, `unterminated_quote`, `quote_junk`, `short_row`, `long_row`).

Referral code: `trpdktbz`
