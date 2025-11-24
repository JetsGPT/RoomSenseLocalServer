# Database Directory

This directory contains SQL scripts for database initialization and migrations.

## Files

- `add_devices_permission.sql` - SQL script to add device permissions

## PostgreSQL Initialization

PostgreSQL initialization scripts are located in `../postgres-init/` directory and are automatically executed on first database startup.

## Usage

To run SQL scripts manually:

```bash
# Connect to PostgreSQL container
docker compose exec postgres psql -U postgres -d user

# Or run a script directly
docker compose exec -T postgres psql -U postgres -d user < database/add_devices_permission.sql
```

