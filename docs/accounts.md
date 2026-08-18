# Accounts and roles

The setup wizard makes its first person an **administrator**; everyone added later
is a **member**. Only administrators can add or deactivate people, change roles,
manage API tokens, switch modules on and off, set the base currency, or configure
and run backups. A member's Settings page holds their own password and their own
passkeys and nothing else — the administrative sections are not merely hidden from
them, they are never sent.

Adding someone in Settings → Household produces a **one-time enrollment link**,
valid for seven days, which you pass to them however you like. They open it and
choose their own password — you never see it. Until they do, they show as "not
enrolled yet" and cannot sign in.

Two knobs, both optional, in `.env`: `PASSWORD_MIN_LENGTH` (default 8) and
`ENROLLMENT_LINK_DAYS` (default 7). The password hints in the interface are fed by
the same value the server enforces, so they cannot disagree.

Deactivating a person blocks sign-in and cuts their live sessions, and voids any
enrollment link they never opened — but it keeps their password, passkeys and all
their history, so reactivating is a clean undo. People are never deleted:
accounts, properties, loans, documents and tax statements reference them.

Two guards mean an instance can never be left without an administrator: you cannot
deactivate yourself, and the last administrator can be neither deactivated nor
demoted. If you somehow lock yourself out, promote someone directly in the
database:

```sh
docker compose exec db psql -U continuum -d continuum \
  -c "UPDATE person SET role = 'admin', deactivated_at = NULL WHERE name = 'Your Name';"
```
