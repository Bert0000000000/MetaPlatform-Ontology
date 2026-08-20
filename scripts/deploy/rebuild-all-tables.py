"""Apply ALL migrations to a fresh schema (handles 'already exists' gracefully)."""
import asyncio
import asyncpg

async def main():
    c = await asyncpg.connect(host='localhost', port=54322, user='postgres', password='postgres', database='postgres')

    # Drop and recreate public schema
    try:
        await c.execute('DROP SCHEMA public CASCADE')
        await c.execute('DROP SCHEMA IF EXISTS mp_preset_registry CASCADE')
        await c.execute('CREATE SCHEMA public')
    except Exception as e:
        print(f'schema reset: {e}')

    # Create extensions
    for ext in ['pgcrypto', '"uuid-ossp"', 'vector']:
        try:
            await c.execute(f'CREATE EXTENSION IF NOT EXISTS {ext}')
        except Exception as e:
            print(f'extension {ext}: {e}')

    await c.close()
    print('schema reset OK')

asyncio.run(main())
