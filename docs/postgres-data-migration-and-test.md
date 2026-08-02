# PostgreSQL Data Migration and DB Verification

This guide explains how to move the planet data from `planets.json` into Azure Database for PostgreSQL and verify that the Solar System app is reading from the database.

## 1. Prepare Python Migration Environment

Newer Ubuntu/Debian systems block global `pip install`, so use a virtual environment:

```bash
cd ~/Solar_System

sudo apt update
sudo apt install python3-venv

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2. Configure PostgreSQL Connection

Set the PostgreSQL environment variables in the same terminal:

```bash
export POSTGRES_HOST="dev-solar-postgres.postgres.database.azure.com"
export POSTGRES_PORT="5432"
export POSTGRES_DB="postgres"
export POSTGRES_USER="postgresadmin"
export POSTGRES_PASSWORD="your_password_here"
```

Use the database name that exists on the server. For Azure PostgreSQL Flexible Server, `postgres` is commonly available by default.

To list database names with Azure CLI:

```bash
az postgres flexible-server db list \
  --resource-group central-dev-rg \
  --server-name dev-solar-postgres \
  --query "[].name" \
  -o table
```

## 3. Allow Network Access

If the VM and PostgreSQL server are in different VNets, either configure VNet peering/private DNS or enable public access for the PostgreSQL server.

For public access:

1. Open the PostgreSQL Flexible Server in Azure Portal.
2. Go to **Settings > Networking**.
3. Enable **Allow public access to this resource through the internet using a public IP address**.
4. Add a firewall rule for the VM public IP.

Find the VM public IP:

```bash
curl ifconfig.me
```

Use the returned IP as both the firewall start and end IP:

```text
Firewall rule name: samplevm
Start IP address: <vm-public-ip>
End IP address:   <vm-public-ip>
```

Save the networking changes and wait about 30-60 seconds.

## 4. Migrate `planets.json` Into PostgreSQL

Run:

```bash
python3 migrate.py
```

Expected output:

```text
Migrated 8 planet(s) into PostgreSQL.
```

The script creates the `planets` table if it does not exist and upserts the rows from `planets.json`.

## 5. Install Node Dependencies

Install app dependencies from the project directory:

```bash
cd ~/Solar_System
npm install
```

If `npm install` fails with `ENOENT: no such file or directory, open '/home/azureuser/package.json'`, you are in the wrong directory. Run `cd ~/Solar_System` first.

## 6. Start the App With DB Config

Make sure the PostgreSQL environment variables are set in the terminal where you start the app:

```bash
export POSTGRES_HOST="dev-solar-postgres.postgres.database.azure.com"
export POSTGRES_PORT="5432"
export POSTGRES_DB="postgres"
export POSTGRES_USER="postgresadmin"
export POSTGRES_PASSWORD="your_password_here"

npm start
```

Expected startup logs:

```text
solar_system_starting on port 3000
postgres_connected
```

If you see `postgres_not_configured`, the app was started without `POSTGRES_HOST`/`POSTGRES_USER` or `DATABASE_URL`.

If port 3000 is already in use:

```bash
lsof -i :3000
kill -9 <PID>
npm start
```

## 7. Test That the App Reads From PostgreSQL

In a second terminal on the VM, call the API:

```bash
curl -X POST http://localhost:3000/planet \
  -H "Content-Type: application/json" \
  -d '{"id":1}'
```

Expected response includes Mercury:

```json
{
  "id": 1,
  "name": "Mercury",
  "image": "https://upload.wikimedia.org/wikipedia/commons/4/4a/Mercury_in_true_color.jpg",
  "velocity": 47,
  "distance": 57
}
```

In the `npm start` terminal, confirm the app used the database:

```text
planet_found Mercury source=db
```

You can also verify with metrics:

```bash
curl http://localhost:3000/metrics | grep planet_data_source_total
```

Expected after one successful DB-backed request:

```text
planet_data_source_total{source="db"} 1
```

If the log says `source=json`, the app did not read from PostgreSQL and fell back to `planets.json`.

## Security Note

Do not commit real database passwords. If a password is pasted into logs, screenshots, or chat, reset the PostgreSQL administrator password in Azure and update `POSTGRES_PASSWORD`.
