# Private studio access from your phone

The studio now has one owner account, `tony`. The React app, MongoDB records and original media still live on this PC. The phone uses the same saved records and approval workflow through an HTTPS Cloudflare Tunnel. MongoDB and the web server continue listening on loopback; no router forwarding or inbound firewall rule is needed.

## First sign-in

Open the private **one-time setup link** supplied with the completed setup. Choose a password or passphrase of at least 15 characters, confirm it, and open the studio. The link expires 24 hours after creation and can be used only once. Its secret is in the URL fragment, which the browser removes before making API requests. The actual password travels only in the HTTPS request body.

After setup, use the regular studio address with username **tony** and your chosen password. There is no public registration or email-based account recovery. **Account** changes the password and signs out all other devices. **Sign out** ends the current session. Sessions expire after seven days; signing in again preserves saved records and browser drafts.

The local files `.data/private/remote-access.txt` and `.data/private/owner-access.txt` contain the initial access/recovery instructions. They are excluded from Git. On Windows, `.data/private` permits access only to the current Windows user and SYSTEM. The generated temporary password stops working when you choose your own password. Used invitation tokens also stop working, even if an old text file or message still contains them.

## Use the phone interface

- Open the menu at the upper left for Overview, Creative library, Episodes, Media library and Series bible.
- Open an episode, then use **Jump to scene**. Each shot image keeps its own approval and rejection controls. Dialogue and video players play inline.
- Saved choices appear on both desktop and phone. Save text edits before switching devices: unsaved drafts stay in the browser where you wrote them. The existing revision/conflict controls preserve simultaneous edits.
- Image, audio, video and editing-package downloads require your signed-in session. Original large uploads and CapCut assembly remain easiest on the desktop. Tunnel/network limits may prevent particularly large transfers even when the studio's local upload limit allows them.

The responsive layouts were checked at 320px and 390px phone widths, 768px tablet width and 1440px desktop width in Chromium and WebKit. Both engines also passed sign-in, setup-form, protected media range and logout checks through the external HTTPS address. Chromium decoded the existing audio/video metadata successfully. The Windows WebKit test build lacks the required media decoders, so playback on physical iOS/Safari has not been verified. This is an online app; it does not cache private studio content for offline use.

The Windows WebKit automation build also reports Strict cookies as None through its cookie-inspection API, a limitation acknowledged by the [upstream Playwright tests](https://github.com/microsoft/playwright/blob/main/tests/library/browsercontext-cookies.spec.ts). The actual HTTPS response was separately checked for `SameSite=Strict`; the server's allowed-origin and CSRF checks are enforced independently of browser cookie policy.

## Start it again

From `C:\projects\roxy-starwars`, first install dependencies and prepare the account if this is a fresh checkout:

```powershell
npm.cmd ci
npm.cmd run auth:setup
npm.cmd run remote:install
```

Existing owners are preserved by `auth:setup`. The installer downloads Windows x64 `cloudflared` from Cloudflare's official GitHub release and verifies its SHA-256 digest before saving the executable in `.data/tools`. It does not install a system service.

Build, then run the production studio in one terminal:

```powershell
npm.cmd run build
npm.cmd run studio
```

`studio` starts or reuses the persistent local MongoDB and serves the built website and protected API together at <http://127.0.0.1:5000>. Do not run it alongside a second API on port 5000. It does not open a browser. For normal local development, `npm.cmd run dev` still provides Vite at <http://127.0.0.1:5173>; sign in there with the same account.

In a second terminal:

```powershell
npm.cmd run remote:start
npm.cmd run remote:status
```

`remote:start` refuses to expose a server unless owner authentication is configured, anonymous studio requests are rejected and the built website is available. It starts a hidden background tunnel, records the approved public origin in `.data/private/remote.json` and writes the current address to `.data/private/remote-access.txt`. Passwords and one-time setup tokens are not printed in terminal output. The Windows wake helper prevents automatic system sleep while the tunnel runs, without changing the power plan or preventing the display from sleeping or the screen from locking. Manual shutdown, restart, hibernation or a lost network connection still interrupt access.

Stop only the studio tunnel with:

```powershell
npm.cmd run remote:stop
```

The command verifies the executable and process creation time before stopping it. Stopping the tunnel releases its wake helper and leaves the local studio and MongoDB running. Ctrl+C in the `studio` terminal stops that launcher and any database it started, preserving the stored data. The initial setup is running in the background for the current session; it is not registered to start automatically after Windows restarts.

## Recover the owner account locally

On the studio PC, run:

```powershell
npm.cmd run auth:reset
```

This replaces the password with a new random temporary one, invalidates existing sessions and creates a fresh single-use setup link in `.data/private/owner-access.txt`. Use its local production link or development link. If the tunnel is already running, combine its current HTTPS address with the new `#setup=...` fragment from the local instructions. Keep that link private. Recovery requires access to your Windows account; the application offers no public password-reset endpoint.

Back up the MongoDB data, original media and private owner configuration securely. Do not publish `.env`, `.data/private`, session cookies, setup links or tunnel logs. The API keys in `server/.env` are never sent to the client.

## Stable address later

The working first version uses a **Quick Tunnel** so it needs no Cloudflare account or domain. Its address changes after a tunnel restart and has no uptime guarantee. Cloudflare describes Quick Tunnels as a testing/development facility, with a 200-concurrent-request limit and no Server-Sent Events support. This app uses normal requests and media ranges. See [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

For a permanent bookmark, configure a named Cloudflare Tunnel and hostname in your own Cloudflare account, pointing only to `http://127.0.0.1:5000`. Set `STUDIO_PUBLIC_ORIGIN=https://your-exact-hostname` in `server/.env` and restart the production server. Retain this application's owner login; optional Cloudflare Access restricted to your email adds another gate. Cloudflare account/domain setup has not been completed or claimed by this implementation.

## Authentication implementation

The owner password uses Node's scrypt with a unique 24-byte salt (`N=131072`, `r=8`, `p=1`). Random 256-bit session secrets are stored only as SHA-256 hashes in MongoDB. Remote cookies use `__Host-`, Secure, HttpOnly, SameSite=Strict and Path=/ with no Domain attribute. Login attempts are throttled in MongoDB, surviving API restarts. All API data and media routes require a valid session; modifications also require the session CSRF token and an allowed origin. Logout, password changes and local recovery revoke sessions. No query-string credential, localhost authentication bypass or environment switch disables the production login. Test fixtures explicitly bypass authentication only in in-process tests; authentication has its own integration suite.

The design follows the [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Source backups from before this work are in `.data/backups/remote-mobile-before-2026-10-19`; verification evidence is in `.data/verification/remote-mobile`.
