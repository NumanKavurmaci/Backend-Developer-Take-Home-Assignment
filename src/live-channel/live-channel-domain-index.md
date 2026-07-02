# Live Channel Domain

Live channels represent linear TV channels.

A live channel can have many EPG programs.

Each EPG program belongs to exactly one live channel through `EpgProgram.channelId`.

EPG schedule validation must always be scoped by `channelId`, so schedules on one channel do not affect schedules on another channel.

## Main Model

```text
LiveChannel
  -> EpgProgram[]
  -> EpgScheduleLock?
```
