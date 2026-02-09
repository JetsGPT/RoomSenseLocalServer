import pkg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Pool } = pkg;

const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration...');

        // 1. Add is_active column if it doesn't exist
        console.log('Adding is_active column...');
        await client.query(`
      ALTER TABLE public.floor_plans 
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;
    `);

        // 2. Create partial unique index to enforce one active plan per user
        console.log('Creating unique index for active floor plans...');
        // We drop it first to be safe in case of re-runs with different names
        await client.query(`
      DROP INDEX IF EXISTS idx_one_active_floor_plan;
    `);

        await client.query(`
      CREATE UNIQUE INDEX idx_one_active_floor_plan 
      ON public.floor_plans (user_id) 
      WHERE (is_active = true);
    `);

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
