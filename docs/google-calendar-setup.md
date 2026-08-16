# Connecting Google Calendar

Google Calendar sync costs nothing. The API is free — a quota of **1,000,000
requests a day**, with no billing account required beneath it — and Continuum
polls every 15 minutes, which is roughly 100–200 requests a day. That is about
0.02% of the free quota.

What it does cost is a one-time setup, because Google will not verify a
self-hosted application on behalf of everyone who installs it. Each household
creates its own OAuth client.

> **Read this before you start.**
>
> **Set the OAuth consent screen to "In production".** Left at "Testing", Google
> expires the refresh token after exactly **7 days** — sync works for a week,
> stops silently, and keeps stopping every week after that. Publishing does
> **not** require verification, does not cost anything, and takes one click.

If you already run Home Assistant's Google Calendar integration, you have a
Cloud project already: skip to step 2 and add a second OAuth client to it.

## 1. Create a Cloud project

1. Open <https://console.cloud.google.com/projectcreate>.
2. Name it anything — "Continuum" is fine. No billing account is needed.

## 2. Enable the Calendar API

1. Go to **APIs & Services → Library**.
2. Search for **Google Calendar API** and press **Enable**.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. User type: **External**, unless your household is on Google Workspace — with
   Workspace, choose **Internal** and none of the warnings below apply at all.
3. Fill in an app name and your own email address. Nothing here is shown to
   anyone but you.
4. Add the scope `https://www.googleapis.com/auth/calendar`.
5. **Set the publishing status to "In production".** This is the step in the
   box above. Do not leave it at Testing.

You will see a "Google hasn't verified this app" screen once, when you
authorise. Choose **Advanced → Go to Continuum (unsafe)**. That warning is what
unverified means; it does not indicate anything is wrong.

An unverified app in production is also capped at 100 users over the project's
lifetime. For a household using its own project, that is not a limit you can
reach.

## 4. Create OAuth credentials

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorised redirect URIs**, add exactly the address you browse
   Continuum on, plus `/settings/google/callback`. For example:

   ```
   http://continuum.local/settings/google/callback
   https://continuum.example.com/settings/google/callback
   ```

   It must match what the browser shows, character for character — a mismatch
   here is the second most common failure after the publishing status.

4. Copy the **client ID** and **client secret**.

## 5. Connect it in Continuum

1. Open **Settings → Connected calendars**.
2. Paste the client ID and secret into the Google Calendar form.
3. Press **Connect**, and authorise in the window that opens.
4. Choose which Google calendar to sync with, and press **Sync now**.

## If something goes wrong

**Sync worked for a week and then stopped.** The consent screen is still at
Testing. Set it to In production and reconnect the account.

**"Google refused the saved authorisation — reconnect the account."** The
refresh token was revoked, or has gone unused for six months. Disconnect and
connect again.

**redirect_uri_mismatch when authorising.** The redirect URI in step 4 does not
match the address you are browsing on. Check for `http` versus `https`, a
trailing slash, and whether you are using a hostname or an IP address.

**Events appear twice.** Do not sync the same Google calendar from two Continuum
instances at once. Each keeps its own view of what it has sent, and neither can
see the other's.

## What Continuum writes

Events the ledger generates itself — loan payments, lease dates, document
expiry — are marked with their module emoji and `· Continuum`, so they are
tellable apart from events you wrote. That marking can be switched off in
Settings.

Editing one of those events in Google mostly does not stick: the ledger owns
them and re-asserts its own version. The exception is moving the **date** of an
event backed by a real record, which is written back to the ledger — see
`ARCHITECTURE.md` for which fields those are.
