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

1. Go to **Google Auth Platform → Audience**. On older consoles this is
   **APIs & Services → OAuth consent screen**.
2. User type: **External**, unless your household is on Google Workspace — with
   Workspace, choose **Internal** and none of the warnings below apply at all.
3. Fill in an app name and your own email address. Nothing here is shown to
   anyone but you.
4. Add the scope **`https://www.googleapis.com/auth/calendar.app.created`**.

   This is deliberately the narrow one. It lets Continuum create a calendar and
   manage events on it, and reach nothing else — it cannot see, edit or delete
   the personal calendars in the account. The blanket
   `https://www.googleapis.com/auth/calendar` scope would grant all of that, is
   far more than this app uses, and is what makes Google flag a consent screen
   as needing approval.

   The trade-off: you cannot point Continuum at a calendar you already made. It
   creates one called **Continuum** the first time you press "Choose a
   calendar", and syncs only that. For a household ledger that is the
   arrangement you would want anyway — one calendar you can hide on your phone
   in a single tap.

5. **Press "Publish app" so the status reads "In production".** This is the step
   in the box above, and the one people miss. Left on Testing, only accounts you
   add under **Test users** may authorise at all — and their tokens expire after
   7 days.

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
4. Press **Choose a calendar**. Continuum creates one called "Continuum" and
   selects it. Then press **Sync now**.

## Does this need doing again?

**No, provided the consent screen says "In production".** The refresh token
Continuum stores does not expire. It stops working only if you revoke Continuum
at myaccount.google.com/permissions, delete the OAuth client, or leave the
connection unused for six months — and the app polls every 15 minutes, so the
last of those cannot happen while it is running.

**If the consent screen still says "Testing", the token expires after exactly 7
days** and you would be reconnecting every week. That is the one thing worth
checking before you walk away from this: **Google Auth Platform → Audience →
Publishing status**.

Publishing needs no verification and costs nothing. The "Google hasn't verified
this app" screen you clicked through is unrelated to token lifetime — it is
simply what an unverified app looks like, which is the correct state for
something only your household uses.

## If something goes wrong

**"The scopes you selected require approval."** You added the broad
`auth/calendar` scope. Remove it and add
`https://www.googleapis.com/auth/calendar.app.created` instead, then reconnect
the account so a token is issued for the new scope.

**"Continuum has not completed the Google verification process. The app is
currently being tested, and can only be accessed by developer-approved
testers."** The consent screen is still on **Testing**, where only accounts on an
explicit list may authorise. Go to **Google Auth Platform → Audience** (older
consoles: **APIs & Services → OAuth consent screen**), press **Publish app**, and
try again.

Adding yourself under **Test users** also works and is quicker — but testing-mode
refresh tokens expire after 7 days, so sync would stop a week later and keep
stopping weekly. Publishing is the real fix and needs no verification.

**"Google hasn't verified this app."** A different screen, and the expected one
once published. Choose **Advanced → Go to Continuum (unsafe)**. It appears
because the app is unverified, which is the correct state for something only your
household uses.

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
