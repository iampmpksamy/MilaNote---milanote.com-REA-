/*
 * Noteboard Homelab Edition — the one place the deployment files come from.
 * Used by the offline settings generator (index.html, in the browser) and by
 * deploy/scripts/render.mjs (Node), which writes the default files in this repository.
 * It never asks for or writes passwords: secrets are created on the server at first start.
 */
(function (root) {
  'use strict';

  var VERSION = '3.0.0-alpha.7';
  var REGISTRY = 'ghcr.io/iampmpksamy';
  var MONGO = 'mongo:8.0.38';
  var REDIS = 'redis:8.10.3-alpine';

  var DEFAULTS = {
    appName: 'Noteboard',
    connection: 'cloudflare', // cloudflare | proxy | lan
    publicUrl: 'https://notes.6dainas.cloud',
    port: 8765,
    bind: '0.0.0.0',
    dataPath: '/DATA/AppData/noteboard',
    tz: 'Asia/Kolkata',
    registration: 'invite',
    adminPath: '/admin',
    maxUploadMb: 25,
    maxMediaMb: 100,
    smtpEnabled: false,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpFrom: '',
    s3Enabled: false,
    s3Endpoint: '',
    s3Region: 'us-east-1',
    s3Bucket: '',
    s3AccessKey: '',
    backupTime: '03:00',
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
    accent: '#2f6fed',
    trustedProxies: 'loopback,linklocal,uniquelocal',
    // A /27 of private addresses for the app's two networks (first /28 internal, second /28 web),
    // so the install doesn't depend on Docker's default address pools (often used up on busy hosts).
    networkBase: '172.31.120.0',
    version: VERSION,
    registry: REGISTRY,
  };

  function merge(o) {
    var r = {};
    for (var k in DEFAULTS) r[k] = DEFAULTS[k];
    for (var j in o || {}) if (o[j] !== undefined && o[j] !== null && o[j] !== '') r[j] = o[j];
    if (o && o.smtpEnabled === false) r.smtpEnabled = false;
    if (o && o.s3Enabled === false) r.s3Enabled = false;
    return r;
  }

  /** The largest request the gateway lets through: pictures or audio/video, whichever is larger. */
  function maxBody(o) {
    return Math.max(Number(o.maxUploadMb) || 0, Number(o.maxMediaMb) || 0);
  }

  /** Returns a list of problems; empty when the settings can be used. */
  function validate(input) {
    var o = merge(input);
    var e = [];
    if (!/^[^"\\\n\r]{1,60}$/.test(String(o.appName))) e.push('App name: 1-60 characters, no quotes or backslashes.');
    var port = Number(o.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) e.push('Host port: a number from 1024 to 65535 (80 and 443 are left to your other services).');
    if (!/^(\d{1,3}\.){3}\d{1,3}$|^::1?$|^0\.0\.0\.0$/.test(String(o.bind))) e.push('Bind address: an IPv4 address such as 0.0.0.0 (all), 127.0.0.1 (this machine only) or your LAN address.');
    else if (/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(o.bind) && o.bind.split('.').some(function (n) { return Number(n) > 255; })) e.push('Bind address: each part must be 0-255.');
    if (o.publicUrl) {
      var u = null;
      try {
        u = new URL(o.publicUrl);
      } catch (x) {
        e.push('Public address: not a valid address (example: https://notes.example.com).');
      }
      if (u) {
        if (u.protocol !== 'https:' && u.protocol !== 'http:') e.push('Public address: must start with https:// or http://.');
        if (u.username || u.password || u.search || u.hash) e.push('Public address: no user name, password, ? or # parts.');
        if (o.connection !== 'lan' && u.protocol !== 'https:') e.push('Public address: use https:// for Cloudflare Tunnel and reverse-proxy access.');
      }
    } else if (o.connection !== 'lan') e.push('Public address: required for Cloudflare Tunnel and reverse-proxy access.');
    if (!/^\/[^\0"\\\n\r]*$/.test(String(o.dataPath)) || /\/\.\.(\/|$)/.test(o.dataPath) || o.dataPath === '/') e.push('Data folder: an absolute path such as /DATA/AppData/noteboard (not / and no ..).');
    try {
      new Intl.DateTimeFormat('en', { timeZone: o.tz });
    } catch (x) {
      e.push('Time zone: not recognised (example: Asia/Kolkata).');
    }
    if (['invite', 'approval', 'open', 'closed'].indexOf(o.registration) < 0) e.push('Registration: invite, approval, open or closed.');
    if (!/^\/[a-z0-9-]{1,40}$/.test(o.adminPath) || ['/api', '/setup', '/login', '/invite', '/reset', '/account'].indexOf(o.adminPath) >= 0) e.push('Admin path: like /admin (lower-case letters, digits, dashes).');
    var mb = Number(o.maxUploadMb);
    if (!Number.isInteger(mb) || mb < 1 || mb > 2048) e.push('Maximum upload: 1 to 2048 MB.');
    var mmb = Number(o.maxMediaMb);
    if (!Number.isInteger(mmb) || mmb < 1 || mmb > 4096) e.push('Maximum audio/video upload: 1 to 4096 MB.');
    if (o.smtpEnabled) {
      if (!/^[a-z0-9.-]+$/i.test(o.smtpHost)) e.push('SMTP server: a host name such as smtp.example.com.');
      var sp = Number(o.smtpPort);
      if (!Number.isInteger(sp) || sp < 1 || sp > 65535) e.push('SMTP port: 1-65535.');
      if (!/@/.test(o.smtpFrom)) e.push('SMTP From: an address such as Noteboard <notes@example.com>.');
    }
    if (o.s3Enabled) {
      try {
        new URL(o.s3Endpoint);
      } catch (x) {
        e.push('S3 endpoint: a full address such as https://s3.example.com.');
      }
      if (!o.s3Bucket) e.push('S3 bucket: required.');
      if (!o.s3AccessKey) e.push('S3 access key: required (the secret key is entered on the server, not here).');
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.backupTime)) e.push('Backup time: HH:MM, 24-hour.');
    ['keepDaily', 'keepWeekly', 'keepMonthly'].forEach(function (k) {
      var v = Number(o[k]);
      if (!Number.isInteger(v) || v < 0 || v > 365) e.push('Backup retention: whole numbers from 0 to 365.');
    });
    if (!/^#[0-9a-f]{6}$/i.test(o.accent)) e.push('Accent colour: like #2f6fed.');
    var nb = String(o.networkBase).split('.').map(Number);
    var privateNet = nb[0] === 10 || (nb[0] === 172 && nb[1] >= 16 && nb[1] <= 31) || (nb[0] === 192 && nb[1] === 168);
    if (nb.length !== 4 || nb.some(function (n) { return !Number.isInteger(n) || n < 0 || n > 255; }) || nb[3] % 32 !== 0 || !privateNet)
      e.push('Network range: a private address ending in 0, 32, 64 … 224 (a free /27), such as 172.31.120.0.');
    return e;
  }

  var q = function (s) {
    return JSON.stringify(String(s));
  };

  function appEnv(o, flavour) {
    // Standard compose reads values from .env (with these as defaults); CasaOS gets them written in.
    var v = function (name, value) {
      return flavour === 'compose' ? '${' + name + ':-' + value + '}' : value;
    };
    var env = [
      ['APP_NAME', v('APP_NAME', o.appName)],
      ['APP_PUBLIC_URL', v('APP_PUBLIC_URL', o.publicUrl)],
      ['TZ', v('TZ', o.tz)],
      ['REGISTRATION_MODE', v('REGISTRATION_MODE', o.registration)],
      ['ADMIN_PATH', v('ADMIN_PATH', o.adminPath)],
      ['ADMIN_MFA_REQUIRED', 'true'],
      ['MAX_UPLOAD_MB', v('MAX_UPLOAD_MB', o.maxUploadMb)],
      ['MAX_MEDIA_MB', v('MAX_MEDIA_MB', o.maxMediaMb)],
      ['STORAGE_DRIVER', v('STORAGE_DRIVER', o.s3Enabled ? 's3' : 'local')],
      ['SMTP_ENABLED', v('SMTP_ENABLED', o.smtpEnabled ? 'true' : 'false')],
      ['SMTP_HOST', v('SMTP_HOST', o.smtpHost)],
      ['SMTP_PORT', v('SMTP_PORT', o.smtpPort)],
      ['SMTP_SECURE', v('SMTP_SECURE', o.smtpSecure ? 'true' : 'false')],
      ['SMTP_USER', v('SMTP_USER', o.smtpUser)],
      ['SMTP_FROM', v('SMTP_FROM', o.smtpFrom)],
      ['BACKUP_TIME', v('BACKUP_TIME', o.backupTime)],
      ['BACKUP_KEEP_DAILY', v('BACKUP_KEEP_DAILY', o.keepDaily)],
      ['BACKUP_KEEP_WEEKLY', v('BACKUP_KEEP_WEEKLY', o.keepWeekly)],
      ['BACKUP_KEEP_MONTHLY', v('BACKUP_KEEP_MONTHLY', o.keepMonthly)],
      ['BRAND_ACCENT', v('BRAND_ACCENT', o.accent)],
      ['TRUSTED_PROXIES', v('TRUSTED_PROXIES', o.trustedProxies)],
      ['COOKIE_SECURE', v('COOKIE_SECURE', 'auto')],
    ];
    if (o.s3Enabled || flavour === 'compose') {
      env.push(['S3_ENDPOINT', v('S3_ENDPOINT', o.s3Endpoint)], ['S3_REGION', v('S3_REGION', o.s3Region)], ['S3_BUCKET', v('S3_BUCKET', o.s3Bucket)]);
      env.push(['S3_ACCESS_KEY', v('S3_ACCESS_KEY', o.s3AccessKey)], ['S3_SECRET_KEY', flavour === 'compose' ? '${S3_SECRET_KEY:-}' : '']);
    }
    return env;
  }

  function envBlock(env, indent) {
    return env
      .map(function (p) {
        return indent + p[0] + ': ' + q(p[1]);
      })
      .join('\n');
  }

  /** flavour: "casaos" (values written in, CasaOS metadata) or "compose" (reads .env). */
  function subnets(base) {
    var p = String(base).split('.').map(Number);
    return [p.join('.') + '/28', [p[0], p[1], p[2], p[3] + 16].join('.') + '/28'];
  }

  function render(input, flavour) {
    var o = merge(input);
    var C = flavour === 'compose';
    var sn = subnets(o.networkBase);
    var data = C ? '${DATA_PATH:-' + o.dataPath + '}' : o.dataPath.replace(/\/+$/, '');
    var name = function (s) {
      return C ? '${NB_INSTANCE:-noteboard}-' + s : 'noteboard-' + s;
    };
    var server = C ? '${NOTEBOARD_SERVER_IMAGE:-' + o.registry + '/noteboard-server:' + o.version + '}' : o.registry + '/noteboard-server:' + o.version;
    var gateway = C ? '${NOTEBOARD_GATEWAY_IMAGE:-' + o.registry + '/noteboard-gateway:' + o.version + '}' : o.registry + '/noteboard-gateway:' + o.version;
    var port = C ? '${APP_BIND:-' + o.bind + '}:${APP_PORT:-' + o.port + '}:8080' : o.bind + ':' + o.port + ':8080';
    var env = envBlock(appEnv(o, flavour), '      ');
    var vol = function (sub, target, ro) {
      return '      - ' + q(data + '/' + sub + ':' + target + (ro ? ':ro' : ''));
    };
    var hard = ['    security_opt:', '      - "no-new-privileges:true"'].join('\n');
    var L = [];
    L.push('# Noteboard Homelab Edition ' + o.version + ' — ' + (C ? 'standard Docker Compose / Portainer (values from .env)' : 'CasaOS (one app tile; also works as a Portainer stack)'));
    L.push('# Generated by deploy/installer. No passwords are in this file: the init service creates them on first start');
    L.push('# and keeps them in ' + (C ? '$DATA_PATH' : data) + '/config/secrets. Only the gateway publishes a port.');
    L.push('name: noteboard');
    L.push('');
    L.push('services:');
    // init
    L.push('  noteboard-init:');
    L.push('    image: ' + q(server));
    L.push('    container_name: ' + q(name('init')));
    L.push('    command: ["node", "init.js"]');
    L.push('    user: "0:0"');
    L.push('    restart: "no"');
    L.push('    network_mode: none');
    L.push('    cap_drop: ["ALL"]');
    L.push('    cap_add: ["CHOWN", "DAC_OVERRIDE", "FOWNER"]');
    L.push(hard);
    L.push('    environment:');
    L.push(env);
    L.push('    volumes:');
    L.push(vol('config', '/data/config'));
    L.push(vol('database', '/data/database'));
    L.push(vol('redis', '/data/redis'));
    L.push(vol('uploads', '/data/uploads'));
    L.push(vol('backups', '/data/backups'));
    L.push(vol('logs', '/data/logs'));
    L.push('');
    // mongo
    L.push('  noteboard-mongo:');
    L.push('    image: ' + q(MONGO));
    L.push('    container_name: ' + q(name('mongo')));
    L.push('    command: ["mongod", "--replSet", "rs0", "--keyFile", "/run/noteboard/secrets/mongo-keyfile", "--bind_ip_all", "--wiredTigerCacheSizeGB", "0.5"]');
    L.push('    restart: unless-stopped');
    L.push('    depends_on:');
    L.push('      noteboard-init:');
    L.push('        condition: service_completed_successfully');
    L.push('    environment:');
    L.push('      MONGO_INITDB_ROOT_USERNAME: "root"');
    L.push('      MONGO_INITDB_ROOT_PASSWORD_FILE: "/run/noteboard/secrets/mongo-root-password"');
    L.push('      TZ: ' + q(C ? '${TZ:-' + o.tz + '}' : o.tz));
    L.push('    volumes:');
    L.push(vol('database', '/data/db'));
    L.push(vol('config/secrets', '/run/noteboard/secrets', true));
    L.push('    networks: ["noteboard-internal"]');
    L.push(hard);
    L.push('    healthcheck:');
    L.push('      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand(\'ping\').ok"]');
    L.push('      interval: 10s');
    L.push('      timeout: 5s');
    L.push('      retries: 12');
    L.push('      start_period: 30s');
    L.push('');
    // redis
    L.push('  noteboard-redis:');
    L.push('    image: ' + q(REDIS));
    L.push('    container_name: ' + q(name('redis')));
    L.push('    command: ["redis-server", "/run/noteboard/secrets/redis.conf"]');
    L.push('    restart: unless-stopped');
    L.push('    depends_on:');
    L.push('      noteboard-init:');
    L.push('        condition: service_completed_successfully');
    L.push('    volumes:');
    L.push(vol('redis', '/data'));
    L.push(vol('config/secrets', '/run/noteboard/secrets', true));
    L.push('    networks: ["noteboard-internal"]');
    L.push(hard);
    L.push('    healthcheck:');
    L.push('      test: ["CMD-SHELL", "REDISCLI_AUTH=\\"$$(sed -n \'s/^requirepass //p\' /run/noteboard/secrets/redis.conf)\\" redis-cli ping | grep -q PONG"]');
    L.push('      interval: 10s');
    L.push('      timeout: 5s');
    L.push('      retries: 12');
    L.push('');
    // api
    L.push('  noteboard-api:');
    L.push('    image: ' + q(server));
    L.push('    container_name: ' + q(name('api')));
    L.push('    command: ["node", "main.js"]');
    L.push('    restart: unless-stopped');
    L.push('    depends_on:');
    L.push('      noteboard-mongo:');
    L.push('        condition: service_healthy');
    L.push('      noteboard-redis:');
    L.push('        condition: service_healthy');
    L.push('    environment:');
    L.push(env);
    L.push('    volumes:');
    L.push(vol('config', '/data/config'));
    L.push(vol('uploads', '/data/uploads'));
    L.push(vol('backups', '/data/backups'));
    L.push(vol('logs', '/data/logs'));
    L.push('    networks: ["noteboard-internal", "noteboard-web"]');
    L.push('    read_only: true');
    L.push('    tmpfs: ["/tmp"]');
    L.push('    cap_drop: ["ALL"]');
    L.push(hard);
    if (!C) {
      L.push('    x-casaos:');
      L.push('      envs:');
      [
        ['APP_NAME', 'Name shown in the app, e-mails and the browser tab'],
        ['APP_PUBLIC_URL', 'The address people open, e.g. https://notes.example.com (used in invitation links)'],
        ['TZ', 'Time zone for scheduled backups'],
        ['REGISTRATION_MODE', 'invite (default), approval, open or closed'],
        ['MAX_UPLOAD_MB', 'Largest picture upload in MB (the gateway allows the larger of this and MAX_MEDIA_MB)'],
        ['MAX_MEDIA_MB', 'Largest audio or video upload in MB (behind Cloudflare keep it at 100 or less: larger requests are refused there)'],
        ['SMTP_ENABLED', 'true to send e-mail; the SMTP password is entered later in /admin'],
        ['BACKUP_TIME', 'Daily backup time (HH:MM)'],
      ].forEach(function (p) {
        L.push('        - container: ' + p[0]);
        L.push('          description:');
        L.push('            en_us: ' + q(p[1]));
      });
      L.push('      volumes:');
      [
        ['/data/config', 'Settings and generated secrets (keep private; needed to open the database)'],
        ['/data/uploads', 'Uploaded pictures'],
        ['/data/backups', 'Automatic and manual backups (copy them to another machine too)'],
        ['/data/logs', 'Server logs'],
      ].forEach(function (p) {
        L.push('        - container: ' + p[0]);
        L.push('          description:');
        L.push('            en_us: ' + q(p[1]));
      });
    }
    L.push('');
    // worker
    L.push('  noteboard-worker:');
    L.push('    image: ' + q(server));
    L.push('    container_name: ' + q(name('worker')));
    L.push('    command: ["node", "worker.js"]');
    L.push('    restart: unless-stopped');
    L.push('    depends_on:');
    L.push('      noteboard-api:');
    L.push('        condition: service_healthy');
    L.push('    environment:');
    L.push(env);
    L.push('    volumes:');
    L.push(vol('config', '/data/config'));
    L.push(vol('uploads', '/data/uploads'));
    L.push(vol('backups', '/data/backups'));
    L.push(vol('logs', '/data/logs'));
    L.push('    networks: ["noteboard-internal", "noteboard-web"]');
    L.push('    read_only: true');
    L.push('    tmpfs: ["/tmp"]');
    L.push('    cap_drop: ["ALL"]');
    L.push(hard);
    L.push('    healthcheck:');
    L.push('      test: ["CMD", "node", "-e", "process.exit(Date.now()-require(\'fs\').statSync(\'/tmp/nb-worker-alive\').mtimeMs<120000?0:1)"]');
    L.push('      interval: 30s');
    L.push('      timeout: 5s');
    L.push('      retries: 3');
    L.push('      start_period: 60s');
    L.push('');
    // gateway
    L.push('  noteboard-gateway:');
    L.push('    image: ' + q(gateway));
    L.push('    container_name: ' + q(name('gateway')));
    L.push('    restart: unless-stopped');
    L.push('    depends_on:');
    L.push('      noteboard-api:');
    L.push('        condition: service_healthy');
    L.push('    environment:');
    // The gateway's request size limit: the larger of the picture and the audio/video limits.
    // The gateway takes the larger of the picture and audio/video limits (see its entrypoint script).
    L.push('      NB_MAX_UPLOAD_MB: ' + q(C ? '${MAX_UPLOAD_MB:-' + o.maxUploadMb + '}' : o.maxUploadMb));
    L.push('      NB_MAX_MEDIA_MB: ' + q(C ? '${MAX_MEDIA_MB:-' + o.maxMediaMb + '}' : o.maxMediaMb));
    L.push('      TZ: ' + q(C ? '${TZ:-' + o.tz + '}' : o.tz));
    L.push('    ports:');
    L.push('      - ' + q(port));
    L.push('    networks: ["noteboard-web"]');
    L.push('    cap_drop: ["ALL"]');
    L.push(hard);
    if (!C) {
      L.push('    x-casaos:');
      L.push('      ports:');
      L.push('        - container: "8080"');
      L.push('          description:');
      L.push('            en_us: "Web app and API (the only published port). Keep it the same as the tile port."');
    }
    L.push('');
    L.push('networks:');
    L.push('  noteboard-internal:');
    L.push('    internal: true');
    L.push('    ipam:');
    L.push('      config:');
    L.push('        - subnet: ' + q(C ? '${NB_SUBNET_INTERNAL:-' + sn[0] + '}' : sn[0]));
    L.push('  noteboard-web:');
    L.push('    ipam:');
    L.push('      config:');
    L.push('        - subnet: ' + q(C ? '${NB_SUBNET_WEB:-' + sn[1] + '}' : sn[1]));
    if (!C) {
      var base = 'https://raw.githubusercontent.com/iampmpksamy/MilaNote---milanote.com-REA-/main/deploy/casaos';
      L.push('');
      L.push('x-casaos:');
      L.push('  architectures: ["amd64"]');
      L.push('  main: noteboard-gateway');
      L.push('  store_app_id: noteboard');
      L.push('  category: Productivity');
      L.push('  author: iampmpksamy');
      L.push('  developer: Noteboard (independent project)');
      L.push('  icon: ' + q(base + '/icon.png'));
      L.push('  thumbnail: ' + q(base + '/screenshots/boards.png'));
      L.push('  screenshot_link:');
      ['boards', 'admin-overview', 'setup'].forEach(function (s) {
        L.push('    - ' + q(base + '/screenshots/' + s + '.png'));
      });
      L.push('  title:');
      L.push('    en_us: ' + q(o.appName));
      L.push('  tagline:');
      L.push('    en_us: "Visual boards for notes, to-dos, links and pictures — private, on your own server"');
      L.push('  description:');
      L.push('    en_us: ' + q('Noteboard is a self-hosted visual board app: notes, to-do lists, links, pictures, columns, lines and nested boards on an endless canvas. Each person has a private account; the administrator panel at ' + o.adminPath + ' manages accounts, invitations, settings and backups. Includes MongoDB, Redis and the background worker — nothing else to install.'));
      L.push('  tips:');
      L.push('    before_install:');
      L.push('      en_us: ' + q('After the first start, open the app and enter the one-time setup token from the noteboard-api log (app settings → Logs) to create the administrator. Data lives in ' + data + ' on a local Linux disk (not a network share). Copy backups to another machine.'));
      L.push('  index: /');
      L.push('  port_map: ' + q(String(o.port)));
      L.push('  scheme: http');
    }
    return L.join('\n') + '\n';
  }

  function envFile(input) {
    var o = merge(input);
    var L = [
      '# Noteboard Homelab Edition — settings for deploy/compose/docker-compose.yml.',
      '# Copy to .env next to the compose file and adjust. No passwords belong here: the server creates',
      '# its own secrets on first start; the SMTP password is entered in the admin panel.',
      '',
      'APP_NAME=' + o.appName,
      'APP_PUBLIC_URL=' + o.publicUrl,
      'APP_PORT=' + o.port,
      'APP_BIND=' + o.bind,
      'DATA_PATH=' + o.dataPath,
      'TZ=' + o.tz,
      'REGISTRATION_MODE=' + o.registration,
      'ADMIN_PATH=' + o.adminPath,
      'MAX_UPLOAD_MB=' + o.maxUploadMb,
      '# Audio and video cards; the gateway allows this size too, so keep it the larger of the two.',
      'MAX_MEDIA_MB=' + o.maxMediaMb,
      'STORAGE_DRIVER=' + (o.s3Enabled ? 's3' : 'local'),
      'SMTP_ENABLED=' + (o.smtpEnabled ? 'true' : 'false'),
      'SMTP_HOST=' + o.smtpHost,
      'SMTP_PORT=' + o.smtpPort,
      'SMTP_SECURE=' + (o.smtpSecure ? 'true' : 'false'),
      'SMTP_USER=' + o.smtpUser,
      'SMTP_FROM=' + o.smtpFrom,
      'S3_ENDPOINT=' + o.s3Endpoint,
      'S3_REGION=' + o.s3Region,
      'S3_BUCKET=' + o.s3Bucket,
      'S3_ACCESS_KEY=' + o.s3AccessKey,
      '# S3_SECRET_KEY=   (only with STORAGE_DRIVER=s3; set it on the server, never commit it)',
      'BACKUP_TIME=' + o.backupTime,
      'BACKUP_KEEP_DAILY=' + o.keepDaily,
      'BACKUP_KEEP_WEEKLY=' + o.keepWeekly,
      'BACKUP_KEEP_MONTHLY=' + o.keepMonthly,
      'BRAND_ACCENT=' + o.accent,
      'TRUSTED_PROXIES=' + o.trustedProxies,
      'NB_INSTANCE=noteboard',
      '# Two small private subnets for the app networks (change if they clash with yours).',
      'NB_SUBNET_INTERNAL=' + subnets(o.networkBase)[0],
      'NB_SUBNET_WEB=' + subnets(o.networkBase)[1],
      '# NOTEBOARD_SERVER_IMAGE=' + o.registry + '/noteboard-server:' + o.version,
      '# NOTEBOARD_GATEWAY_IMAGE=' + o.registry + '/noteboard-gateway:' + o.version,
      '',
    ];
    return L.join('\n');
  }

  function summary(input) {
    var o = merge(input);
    var lines = [
      'Noteboard ' + o.version + ' — ' + o.appName,
      'Open on your network: http://<server-ip>:' + o.port + '/   (published on ' + o.bind + ':' + o.port + ')',
      'Public address: ' + (o.publicUrl || '(none — LAN only)'),
      'Data folder: ' + o.dataPath + '  (config, database, redis, uploads, backups, logs)',
      'Time zone: ' + o.tz + ' · daily backup at ' + o.backupTime + ' · keep ' + o.keepDaily + ' daily / ' + o.keepWeekly + ' weekly / ' + o.keepMonthly + ' monthly',
      'New accounts: ' + o.registration + ' · admin panel at ' + o.adminPath + ' (two-step sign-in required)',
      'E-mail: ' + (o.smtpEnabled ? o.smtpHost + ':' + o.smtpPort + ' (enter the password in the admin panel)' : 'off — share invitation and reset links yourself'),
      'Pictures: ' + (o.s3Enabled ? 'S3 bucket ' + o.s3Bucket + ' at ' + o.s3Endpoint + ' (set S3_SECRET_KEY on the server)' : 'local folder ' + o.dataPath + '/uploads'),
      'Max upload: ' + o.maxUploadMb + ' MB pictures, ' + o.maxMediaMb + ' MB audio/video',
    ];
    return lines.join('\n');
  }

  function instructions(input) {
    var o = merge(input);
    var host = '';
    try {
      host = new URL(o.publicUrl).host;
    } catch (x) {
      host = 'notes.example.com';
    }
    if (o.connection === 'cloudflare')
      return [
        'Cloudflare Tunnel (uses your existing tunnel; nothing new is installed):',
        '1. Install Noteboard (CasaOS → + → Install a customized app → Import, paste the YAML).',
        '2. In Cloudflare Zero Trust → Networks → Tunnels → your tunnel → Public Hostname → Add:',
        '     Hostname: ' + host + '    Service: HTTP  ' + (o.bind === '127.0.0.1' ? 'localhost' : '<server-LAN-IP>') + ':' + o.port,
        '   (a locally managed tunnel: add "- hostname: ' + host + '  service: http://' + (o.bind === '127.0.0.1' ? 'localhost' : '<server-LAN-IP>') + ':' + o.port + '" to its config.yml ingress, above the catch-all, and restart cloudflared).',
        '3. Cloudflare → Caching → Cache Rules: "Bypass cache" for hostname ' + host + ' and path /api/* (the app also sends no-store).',
        '4. If uploads above 100 MB are needed, note Cloudflare\'s request size limit on your plan.',
        '5. Open https://' + host + '/ and finish the setup wizard with the setup token from the noteboard-api log.',
      ].join('\n');
    if (o.connection === 'proxy')
      return [
        'Your own reverse proxy (Nginx, Caddy, Traefik, Nginx Proxy Manager) with HTTPS:',
        '1. Point DNS for ' + host + ' to your public IP; forward 443 to the proxy (not to Noteboard).',
        '2. Proxy https://' + host + ' to http://' + (o.bind === '127.0.0.1' ? '127.0.0.1' : '<server-LAN-IP>') + ':' + o.port + ' — see deploy/nginx/reverse-proxy.conf.',
        '   Pass Host, X-Forwarded-For, X-Forwarded-Proto and WebSocket upgrade headers; set client_max_body_size ' + maxBody(o) + 'm.',
        '3. Keep the proxy on a private address so its forwarded headers are trusted (TRUSTED_PROXIES=' + o.trustedProxies + ').',
        '4. Never forward ports for MongoDB or Redis: they are not published at all.',
      ].join('\n');
    return [
      'LAN / Tailscale:',
      '1. Open http://<server-LAN-IP>:' + o.port + '/ from your network. Plain HTTP is fine for first setup on a trusted LAN;',
      '   for everyday use and for the installable app (PWA) use HTTPS:',
      '2. Tailscale: run "tailscale serve --bg --https=443 http://127.0.0.1:' + o.port + '" on the server and use https://<machine>.<tailnet>.ts.net',
      '   as the public address (Admin → Settings), or put a local reverse proxy with a certificate in front.',
      '3. Nothing is reachable from the internet unless you forward a port yourself.',
    ].join('\n');
  }

  var api = { VERSION: VERSION, DEFAULTS: DEFAULTS, validate: validate, render: render, envFile: envFile, summary: summary, instructions: instructions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteboardCompose = api;
})(typeof self !== 'undefined' ? self : this);
