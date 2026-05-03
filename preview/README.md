# eikon preview

Two TUI entry points:

```bash
bun run src/index.tsx [path/to/file.eikon]   # play a finished .eikon (all states, grid)
bun run src/author.tsx [path/to/states/]      # author: tune chafa knobs against source mp4s
```

`author.tsx` and `scripts/mk_eikon.ts` share `scripts/lib.ts`, so the
preview is byte-identical to the packed output. Keys: `←/→` state,
`↑/↓` select knob, `h/l` change, `r` reset, `w` write `.eikon`,
`c` copy the equivalent `mk_eikon` CLI, `q` quit.

Requires `ffmpeg` + `chafa` on PATH.
