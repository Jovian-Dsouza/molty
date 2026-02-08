## Molty

```
pnpm install

cp apps/kiosk/.env.sample apps/kiosk/.env

pnpm dev
```

## Openclaw

```
sh deploy.sh 3.109.239.115 ../hackmoney-lightsail.pem
```

Set the env var in OpenClaw config so the gateway always has it:

1. On the server, run:

```
openclaw config set env.vars.STORK_API_KEY "YOUR_STORK_KEY"
openclaw config set env.vars.PRIVATE_KEY "PRIVATE_KEY"
openclaw config set env.vars.LIFI_API_KEY "LIFI_API_KEY"
```

2. Restart OpenClaw (usually auto after config writes; if not):

```
openclaw gateway restart
```
