# AIK Tasks

Single-page roadmap UI with a small Node backend for admin login and persistent task creation.

## Run

1. Open a terminal in `backend`.
2. Copy `.env.example` to `.env` and set a valid PostgreSQL `DATABASE_URL`.
3. Install dependencies with `npm install`.
4. Run `node server.js`.
5. Open `http://localhost:3000`.

## PostgreSQL

- The backend now stores admin-created tasks in PostgreSQL.
- On startup it creates the `tasks` table automatically if it does not exist.
- If `backend/data/tasks.json` still exists from the old storage model, the backend imports those legacy tasks into PostgreSQL the first time it finds an empty `tasks` table.
- Default example connection string: `postgresql://postgres:postgres@127.0.0.1:5432/aik_tasks`
- If PostgreSQL is unavailable, the site still serves the frontend, but admin-backed task loading and creation stay offline until the database connection works.

## Admin

- Click `Admin` in the top bar.
- Login with the backend credentials.
- Create new tasks from the admin panel.
- New tasks are stored in PostgreSQL instead of `backend/data/tasks.json`.
