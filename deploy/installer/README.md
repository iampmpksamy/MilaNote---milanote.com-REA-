# Settings generator (before installing)

Open `index.html` in any browser — straight from the folder, no server needed. It works offline and
sends nothing anywhere (its Content-Security-Policy forbids network requests; a test checks it).

Choose the app name, connection method (Cloudflare Tunnel / own proxy / LAN-Tailscale), public
address, port, bind address, data folder, time zone, registration mode, upload limit, network range,
optional SMTP and S3, backup time and retention, and accent colour. It checks every value and gives:

- the **CasaOS YAML** (values written in — paste into *Install a customized app → Import*; also works
  as a Portainer stack),
- a **docker-compose.yml** and **.env** for plain Docker Compose,
- a **summary**, and **step-by-step instructions** for the chosen connection method.

It never asks for passwords: the server creates its own secrets, and the SMTP password is entered in
the admin panel (stored encrypted). `compose.js` is the single source for all deployment files; run
`node ../scripts/render.mjs` after changing it to refresh `../casaos` and `../compose`.
