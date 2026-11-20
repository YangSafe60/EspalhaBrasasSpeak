# Permission model

Permissions are `u64` bitflags (see `crates/shared`).

## Bits

| Flag | Meaning |
|------|---------|
| VIEW_CHANNEL | See channel |
| SEND_MESSAGES | Post in text |
| MANAGE_MESSAGES | Edit/delete others' messages |
| CONNECT | Join voice |
| SPEAK | Publish mic |
| STREAM | Publish screen |
| MUTE_MEMBERS / MOVE_MEMBERS | Voice moderation |
| MANAGE_CHANNELS | Create/edit/delete channels + themes |
| MANAGE_ROLES | Roles + overwrites |
| MANAGE_SERVER | Branding, rules |
| KICK_MEMBERS / BAN_MEMBERS | Moderation |
| CREATE_INVITE | Invites |
| ATTACH_FILES / ADD_REACTIONS | Media + emoji |
| ADMINISTRATOR | All permissions |

`@everyone` defaults to a safe social subset (`EVERYONE_DEFAULT`).

## Resolution

1. Server owner → all permissions
2. Aggregate member roles (by position) including `@everyone`
3. If `ADMINISTRATOR` → all
4. Apply channel role overwrites (allow/deny), then member overwrite
5. Deny wins over allow on the same bit

Channel UI uses explicit Allow / Deny / Inherit rather than opaque checkboxes only.

## Screen sharing needs STREAM

Publishing a screen requires `STREAM` in that voice channel:

- the desktop app gets a dedicated screen token (`/voice/screen-token`),
  which is refused without `STREAM`;
- the normal voice token only allows the screen sources (`screen_share`,
  `screen_share_audio`) when the member has `STREAM`, so it cannot be used to
  publish a screen either. Mic/camera follow `SPEAK` the same way.

`CONNECT` alone lets a member join and watch, not stream.
