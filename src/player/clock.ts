export type Clock = {
  now: () => number
}

export const systemClock = (): Clock => ({ now: () => performance.now() })

export const fixedClock = (ms: number): Clock => ({ now: () => ms })

export const manualClock = (ms = 0): Clock & { tick: (dt: number) => void; set: (next: number) => void } => {
  let cur = ms
  return {
    now: () => cur,
    tick(dt) { cur += dt },
    set(next) { cur = next },
  }
}
