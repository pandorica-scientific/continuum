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

## Open mode

An instance can be run with **no credentials at all**: an administrator drops them
for the whole install, confirmed with their own password, and the setup wizard can
start one that way too. Everyone who opens the address is signed in as whoever they
pick — there are no passwords, no passkeys and no enrollment links while it is on.
This is for a household that keeps the instance on a network only they can reach
and does not want a sign-in between them and their own figures. The warning lives on
Settings and on the sign-in page, where somebody who did not expect it actually
meets it; it used to sit on every screen, where it became furniture.

Know what it means before turning it on: **anyone who can reach the URL is any
person on the instance**, administrator included, and can read every statement,
salary figure, mortgage balance and tax statement, use the API and export the lot.
On a plain-HTTP LAN address that is everyone on the network.

Only an administrator can turn it on, and only by re-entering their own password —
the last moment a password can prove intent. Turning it **off** needs nothing:
anyone already inside could close the door anyway, and asking for a credential to
close a door that is open would only stop the honest. Passwords and passkeys are
never deleted, so turning it off restores normal sign-in with every credential
intact.

It governs interactive sign-in only. The `/api` boundary, calendar feed tokens and
enrollment tokens keep their own checks and are not routed around.

## Never without an administrator

Two guards mean an instance can never be left without an administrator: you cannot
deactivate yourself, and the last administrator can be neither deactivated nor
demoted. If you somehow lock yourself out, promote someone directly in the
database:

```sh
docker compose exec db psql -U continuum -d continuum \
  -c "UPDATE person SET role = 'admin', deactivated_at = NULL WHERE name = 'Your Name';"
```
