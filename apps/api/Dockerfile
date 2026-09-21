# Milestone 8 (docs/09-phase1-implementation-plan.md) — one image for both
# Fargate tasks. `api` and `worker` are the same compiled `dist/` output
# (nest build produces both dist/main.js and dist/worker-main.js from one
# tsconfig, see package.json's own "build"/"worker" scripts) — the ECS task
# definition picks the entrypoint via CMD override, not a second image.
# Multi-stage so the shipped image has no devDependencies, no TypeScript
# compiler, and no source .ts files.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# `node-pg-migrate` is a devDependency (it's a one-time deploy tool, not
# something the running api/worker processes import) — the slim `runtime`
# stage below never installs it. RDS has no public endpoint (ADR D4), so
# migrations have to run from *inside* the VPC regardless; this stage is
# what infra/ecs.tf's one-off "migrate" task definition runs, via
# `aws ecs run-task` from the deploy pipeline, never a standing service.
FROM build AS migrate
WORKDIR /app
COPY migrations ./migrations
CMD ["npm", "run", "migrate:up"]

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Neither entrypoint binds a port other than $PORT (api) or none at all
# (worker) — no EXPOSE needed beyond documenting the api task's default.
EXPOSE 3000

# Default to the api entrypoint; the worker Fargate task definition
# overrides this command to `node dist/worker-main.js` (see
# infra/ecs.tf) rather than building a second image for one CMD.
CMD ["node", "dist/main.js"]
