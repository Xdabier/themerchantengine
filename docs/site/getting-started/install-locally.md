---
title: Install locally
description: Run the whole engine on a laptop with Docker Desktop. Linux and macOS through setup.sh, Windows through setup.ps1, the local ports, the demo catalogue, where mail goes, how long it takes, and how to tear it down.
primaryQuery: ecommerce platform local docker desktop
updated: 2026-09-08
schema: HowTo
---

The same installer that sets up a server runs the whole engine on a laptop: the API, the admin, the storefront, Postgres and Redis in Docker, on local ports, with no TLS, no third-party accounts and a demo catalogue. It is the fastest way to see the product, to evaluate it, or to develop a storefront against a real API. A first install measured seven minutes on a Windows laptop with Docker Desktop; a re-run took twenty-six seconds.

## What you need

- **Docker Desktop** on [Windows](https://docs.docker.com/desktop/setup/install/windows-install/) or [macOS](https://docs.docker.com/desktop/setup/install/mac-install/), running before you start. On Linux, Docker Engine with the Compose v2 plugin as on a server. Give Docker at least four gigabytes of memory; the three image builds are the heavy part.
- **git** and **Node.js 22**. The wrapper refuses any other Node major and names the one it wants.
- Ports 53000, 53200 and 53300 free. The wrapper stops on a taken port; on Windows it names the process holding it, on Linux and macOS it gives you the `ss` command that does.
- No license, no bucket, no Resend, no Turnstile. The local profile runs unlicensed, stores assets on disk, keeps every email on the machine and runs sign-up without a captcha.

## Linux and macOS

```bash
git clone <the engine repository> themerchantengine
cd themerchantengine
./setup.sh --local
```

## Windows

Open PowerShell (5.1 or 7 both work) in the cloned directory:

```powershell
git clone <the engine repository> themerchantengine
cd themerchantengine
.\setup.ps1
```

`setup.ps1` installs the local profile only. A server install runs `setup.sh` on the box itself, so a Windows laptop can never be told to issue certificates it cannot serve. If PowerShell answers that running scripts is disabled on this system, run it as `powershell -ExecutionPolicy Bypass -File .\setup.ps1`. The wrapper takes `-Answers <file>`, `-DryRun`, `-Reset` and `-State <file>`, the same options as the flags of the Linux wrapper.

## What the local profile asks

The same stepper as a server, with the server-only prompts answered for you:

- **License file:** empty is allowed. The admin shows the license as `missing`; nothing refuses to start.
- **Domains:** not asked. The origins are `http://localhost:53300` (storefront), `http://localhost:53200` (admin) and `http://localhost:53000` (API).
- **Asset storage:** not asked. Uploads are written to `./uploads` on this machine and served by the API.
- **Transactional mail:** one prompt, the address every local email is redirected to. Nothing leaves the machine: mail goes to the API container's log, addressed to that address, so a password reset or an order confirmation is read with `docker logs`.
- **Turnstile:** off by default. Say yes only if you have a widget configured for `localhost`.
- **Payment methods:** cash on delivery on, the rest off.
- **Demo catalogue:** on by default. Products, categories, a customer and sample orders, with copy in French and English, so the storefront and the admin have something to show.

Identity, brand, locales, money and the owner account are asked as on a server, with the same defaults.

## Where things are

- The store: storefront at `http://localhost:53300`, admin at `http://localhost:53200`, API at `http://localhost:53000` with the health endpoint at `/health` and the public configuration at `/api/v1/store/config`.
- The stack: `deploy/local/docker-compose.yml`, with its own `.env` and `.env.storefront` beside it. The developer's own `.env` at the repository root, the one `nx serve` reads, is not touched, so a local install and a development checkout coexist.
- The containers: `themerchantengine-postgres`, `-redis`, `-api`, `-admin`, `-storefront` and `-edge`. The edge is the same nginx a server runs, without TLS, so the admin and the storefront reach the API the way they do in production.
- The data: the Docker volumes `themerchantengine_pg-data` and `themerchantengine_redis-data`, and `./uploads` for assets.

Systemd timers are Linux-only; on macOS and Windows the installer says so and schedules neither renewal nor backups, which a local install does not need.

## Everyday commands

```bash
COMPOSE="docker compose -f deploy/local/docker-compose.yml --env-file deploy/local/.env"
$COMPOSE ps                                  # what is running
$COMPOSE logs -f --tail 100 api              # the API log, where local mail lands
$COMPOSE stop                                # stop, keep the data
$COMPOSE start                               # start again
./setup.sh --local                           # update after a git pull, or repair; a re-run is idempotent
$COMPOSE down -v                             # tear down, delete the data
```

On Windows, run the `docker compose` lines as written in PowerShell without the `$COMPOSE` shorthand, or set `$COMPOSE` as a PowerShell variable and invoke it with `Invoke-Expression`.

## Next

Sign in at `http://localhost:53200` with the owner account you created and follow [The first hour](./first-hour.md). Building your own storefront against this install starts with the public configuration at `http://localhost:53000/api/v1/store/config`.
