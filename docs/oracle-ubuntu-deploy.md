# Oracle Cloud Ubuntu 24/7 Deployment

This guide deploys the Discord Gemini Agent as a `systemd` service on an Oracle Cloud Ubuntu VM.

## 1. Create the VM

Recommended minimum:

- OS: Ubuntu 22.04 or 24.04
- Shape: Oracle Always Free Ampere or AMD shape is fine
- RAM: 1 GB minimum, 2 GB preferred
- Network: outbound HTTPS must be allowed

The bot does not need inbound ports. Discord and Gemini are outbound connections.

## 2. Copy the project to the VM

From your PC, copy the project folder to the VM:

```bash
scp -r ./discord-gpt-agent ubuntu@YOUR_VM_PUBLIC_IP:~/discord-gpt-agent
```

Or push the project to a private Git repository and clone it on the VM.

## 3. Install as a service

On the VM:

```bash
cd ~/discord-gpt-agent
chmod +x deploy/install-ubuntu.sh deploy/ops.sh
sudo ./deploy/install-ubuntu.sh
```

The installer copies the app to:

```text
/opt/discord-gpt-agent
```

It also installs:

```text
/etc/systemd/system/discord-gpt-agent.service
```

## 4. Configure secrets

Edit the runtime environment file:

```bash
sudo nano /opt/discord-gpt-agent/.env
```

The installer creates `.env` from `.env.production.example` when available.

Required:

```env
DISCORD_TOKEN=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
WAKE_PHRASE=재명아
MAX_CONTEXT_MESSAGES=5
DISCORD_ALLOWED_CHANNEL_IDS=1499319149116002376,692737843604488216
ENABLE_GOOGLE_SEARCH=1
```

This project also accepts `OPENAI_API_KEY` as a legacy name for the Gemini key, but `GEMINI_API_KEY` is clearer.

Lock down permissions:

```bash
sudo chmod 600 /opt/discord-gpt-agent/.env
sudo chown ubuntu:ubuntu /opt/discord-gpt-agent/.env
```

## 5. Test before starting

```bash
cd /opt/discord-gpt-agent
node --check src/index.js
npm run check
npm run doctor
```

If `npm run doctor` fails with `429 RESOURCE_EXHAUSTED`, the Gemini API quota is exhausted. The service can still start, but model replies will fail until quota resets or billing is enabled.

## 6. Start 24/7 service

```bash
sudo systemctl start discord-gpt-agent
sudo systemctl status discord-gpt-agent
```

View logs:

```bash
sudo journalctl -u discord-gpt-agent -f
```

Restart after edits:

```bash
sudo systemctl restart discord-gpt-agent
```

Stop:

```bash
sudo systemctl stop discord-gpt-agent
```

## 7. Update deployment

Copy or pull the new project version, then:

```bash
cd ~/discord-gpt-agent
sudo ./deploy/install-ubuntu.sh
sudo systemctl restart discord-gpt-agent
```

## 8. Health checklist

Check service:

```bash
sudo systemctl is-active discord-gpt-agent
```

Check logs:

```bash
sudo journalctl -u discord-gpt-agent -n 100 --no-pager
```

Check Discord and Gemini:

```bash
cd /opt/discord-gpt-agent
npm run doctor
```

Expected service log lines:

```text
Logged in as ...
Wake phrase: 재명아
Gemini model: gemini-2.5-flash
Google Search grounding: on
```
