# CodeGuard AI

AI code review: React + Vite + Monaco client, Express + Prisma + PostgreSQL server, OpenAI for analysis.

## Setup
1. `cp .env.example .env` and set `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`.
2. `cd server && npm i && npx prisma migrate dev --schema ../prisma/schema.prisma --name init && npm run dev`
3. `cd client && npm i && npm run dev` then open http://localhost:5173
4. Tests: `cd server && npm test`

## API
Auth: `POST /api/auth/register|login|logout`, `GET /api/auth/me`
Reviews: `GET /api/reviews?search=&language=`, `GET|DELETE /api/reviews/:id`
AI: `POST /api/ai/analyze` (analyzes and saves), `POST /api/ai/fix` ({reviewId, issueId})
Reports: `GET /api/reports/:id/json`

## Production
`npm run build` in each folder; run `npx prisma migrate deploy`; serve `client/dist` statically; set `NODE_ENV=production`.
